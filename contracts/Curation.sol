pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/misc/Migrations.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";

import "staking/contracts/IStakingLocking.sol";
import "@aragon/apps-registry/contracts/interfaces/IRegistry.sol";
import "./interfaces/IVoting.sol";


contract Curation is AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;

    uint64 constant public MAX_UINT64 = uint64(-1);
    uint256 constant public PCT_BASE = 10 ** 18; // 0% = 0; 1% = 10^16; 100% = 10^18
    bytes32 constant public MIN_DEPOSIT_PARAM = keccak256("MIN_DEPOSIT_PARAM");
    bytes32 constant public APPLY_STAGE_LEN_PARAM = keccak256("APPLY_STAGE_LEN_PARAM");
    bytes32 constant public DISPENSATION_PCT_PARAM = keccak256("DISPENSATION_PCT_PARAM");

    IRegistry public registry;
    IStakingLocking public staking;
    IVoting public voting;
    uint256 public minDeposit;
    uint64 public applyStageLen;
    uint256 public dispensationPct;

    bytes32 constant public CHANGE_PARAMS_ROLE = keccak256("CHANGE_PARAMS_ROLE");
    bytes32 constant public CHANGE_VOTING_APP_ROLE = keccak256("CHANGE_VOTING_APP_ROLE");

    struct Submission {
        address submitter;
        uint64 date;
        bool registered;
        bytes data;
        uint256 amount;
        uint256 lockId;
    }

    struct Challenge {
        address challenger;
        uint64 date;
        uint256 amount;
        uint256 lockId;
        uint256 voteId;
        uint256 dispensationPct;
    }

    struct Vote {
        bool closed;
        bool result;
        uint256 votersRewardPool;
        uint256 totalWinningStake;
        mapping(address => bool) claims; // participants who already claimed their reward
    }

    mapping(bytes32 => Submission) submissions;
    mapping(bytes32 => Challenge) challenges;
    mapping(uint256 => Vote) votes;
    mapping(address => mapping(uint256 => bool)) usedLocks;

    event NewSubmission(bytes32 indexed entryId, address submitter);
    event NewChallenge(bytes32 indexed entryId, address challenger);
    event ResolvedChallenge(bytes32 indexed entryId, bool result);

    /**
     * @notice Initializes Curation app with
     * @param _registry Registry app to be used for registering accepted entries
     * @param _staking Staking app to be used for staking and locking tokens
     * @param _voting Voting app to be used for Challenges
     * @param _minDeposit Minimum amount of tokens needed for Submissions and Challenges
     * @param _applyStageLen Duration after which an submission gets registered if it doesn't receive any challenge
     * @param _dispensationPct Percentage of deposited tokens awarded to the winning party (submitter or challenger). The rest will be distributed among voters
     */
    function initialize(
        IRegistry _registry,
        IStakingLocking _staking,
        IVoting _voting,
        uint256 _minDeposit,
        uint64 _applyStageLen,
        uint256 _dispensationPct
    )
        onlyInit
        external
    {
        initialized();

        require(isContract(_registry));
        require(isContract(_staking));

        registry = _registry;
        staking = _staking;
        _setVotingApp(_voting);

        _setMinDeposit(_minDeposit);
        _setApplyStageLen(_applyStageLen);
        _setDispensationPct(_dispensationPct);
    }

    /**
     * @notice Submit new submission for "`data`" using lock `lockId`
     * @param data Content of the submission
     * @param lockId Id of the lock from Staking app used for the submission
     * @return Id of the new entry
     */
    function newSubmission(bytes data, uint256 lockId) isInitialized public returns (bytes32 entryId) {
        entryId = keccak256(data);

        require(data.length != 0);
        // check data doesn't have an ongoing submission
        require(!submissionExists(entryId));
        // check data doesn't exist in Registry
        require(!registry.exists(entryId));

        // check locked tokens
        uint256 amount = _checkLock(msg.sender, lockId, MAX_UINT64);

        submissions[entryId] = Submission({
            submitter: msg.sender,
            date: getTimestamp64(),
            registered: false,
            data: data,
            amount: amount,
            lockId: lockId
        });

        // register used lock
        emit NewSubmission(entryId, msg.sender);
    }

    /**
     * @notice Challenge submission for entry with id `entryId` using lock wiht id `lockId`
     * @param entryId Id of the submission being challenged
     * @param lockId Id of the lock from Staking app used for the submission
     * @return Id of the Challenge, which is the same as the Submission one
     */
    function challengeSubmission(bytes32 entryId, uint256 lockId) isInitialized public returns(bytes32) {
        // check submission doesn't have an ongoing challenge
        require(!challengeExists(entryId));

        // touch-and-remove case
        Submission memory submission = submissions[entryId];
        if (submission.amount < minDeposit) {
            staking.unlock(submission.submitter, submission.lockId);
            delete(submissions[entryId]);
            registry.remove(entryId);
            return 0;
        }

        // check locked tokens
        uint256 amount = _checkLock(msg.sender, lockId, getTimestamp64().add(applyStageLen));

        // create vote
        // TODO: metadata
        // script to call `resolveChallenge(entryId)`
        uint256 scriptLength = 64; // 4 (spec) + 20 (address) + 4 (calldataLength) + 4 (signature) + 32 (input)
        bytes4 spec = bytes4(0x01);
        bytes4 calldataLength = bytes4(0x24); // 4 + 32
        bytes4 signature = this.resolveChallenge.selector;
        bytes memory executionScript = new bytes(scriptLength);
        // concatenate spec + address(this) + calldataLength + calldata
        // TODO: should we put this somewhere in aragonOS to be able to reuse it? (if it's not already there)
        assembly {
            mstore(add(executionScript, 0x20), spec)
            mstore(add(executionScript, 0x24), mul(address, exp(2,96)))
            mstore(add(executionScript, 0x38), calldataLength)
            mstore(add(executionScript, 0x3C), signature)
            mstore(add(executionScript, 0x40), entryId)
        }

        uint256 voteId = voting.newVote(executionScript, "");

        challenges[entryId] = Challenge({
            challenger: msg.sender,
            date: getTimestamp64(),
            amount: amount,
            lockId: lockId,
            voteId: voteId,
            dispensationPct: dispensationPct
        });

        votes[voteId] = Vote({
            closed: false,
            result: false,
            totalWinningStake: 0,
            votersRewardPool: 0
        });

        emit NewChallenge(entryId, msg.sender);

        return entryId;
    }

    /**
     * @notice Resolve Challenge for entry with id `entryId`
     * @param entryId Id of the Submission/Challenge
     */
    function resolveChallenge(bytes32 entryId) isInitialized public {
        require(challengeExists(entryId));
        Challenge storage challenge = challenges[entryId];
        Submission storage submission = submissions[entryId];
        Vote storage vote = votes[challenge.voteId];

        require(voting.isClosed(challenge.voteId));
        vote.closed = true;
        (vote.result, vote.totalWinningStake,) = voting.getVoteResult(challenge.voteId);

        address winner;
        address loser;
        uint256 loserLockId;
        uint256 amount;
        if (vote.result == false) { // challenge not accepted (submission remains)
            winner = submission.submitter;
            loser = challenge.challenger;
            loserLockId = challenge.lockId;
            amount = challenge.amount;

            // it's still in submission phase (not registered yet)
            if (!submission.registered) {
                submission.registered = true;
                // insert in Registry app
                registry.add(submission.data);
            }
        } else { // challenge accepted (submission rejected)
            winner = challenge.challenger;
            loser = submission.submitter;
            loserLockId = submission.lockId;
            amount = submission.amount;

            // Remove from Registry app
            submission.registered = false;
            registry.remove(entryId);
        }
        // compute rewards
        uint256 reward = amount.mul(dispensationPct) / PCT_BASE;
        vote.votersRewardPool = amount - reward;

        // redistribute tokens
        // TODO!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        staking.transferFromLock(loser, loserLockId, reward, winner, 0);
        staking.moveTokens(loser, address(this), vote.votersRewardPool);

        // unlock tokens from Staking app
        staking.unlock(submission.submitter, submission.lockId);
        staking.unlock(challenge.challenger, challenge.lockId);

        // Remove used locks
        delete(usedLocks[submission.submitter][submission.lockId]);
        delete(usedLocks[challenge.challenger][challenge.lockId]);

        // Remove challenge, and submission if needed
        if (vote.result == true) {
            delete(submissions[entryId]);
        }
        delete(challenges[entryId]);

        emit ResolvedChallenge(entryId, vote.result);
    }

    /**
     * @notice Claim reward for a Challenge as a voter for vote with id `voteId`
     * @param voteId Id of the Vote
     */
    function claimReward(uint256 voteId) isInitialized public {
        require(votes[voteId].closed);

        Vote storage vote = votes[voteId];

        // avoid claiming twice
        require(!vote.claims[msg.sender]);

        // register claim to avoid claiming it again
        vote.claims[msg.sender] = true;

        // reward as a voter
        uint256 voterWinningStake = voting.getVoterWinningStake(voteId, msg.sender);
        require(voterWinningStake > 0);
        // rewardPool * (voter / total)
        uint256 reward = vote.votersRewardPool.mul(voterWinningStake) / vote.totalWinningStake;
        // Redistribute tokens
        staking.transfer(reward, msg.sender, 0);
    }

    /**
     * @notice Register unchallenged submission with id `entryId`
     * @param entryId Id of the Submission
     */
    function registerUnchallengedSubmission(bytes32 entryId) isInitialized public {
        require(canBeRegistered(entryId));

        Submission storage submission = submissions[entryId];
        require(!submission.registered);
        submission.registered = true;

        // insert in Registry app
        registry.add(submission.data);
    }

    /**
     * @notice Remove Submission with id `entryId` by submitter, and unlock deposit
     * @param entryId Id of the Submission
     */
    function removeSubmission(bytes32 entryId) isInitialized public {
        // check submission doesn't have an ongoing challenge
        require(!challengeExists(entryId));

        Submission memory submission = submissions[entryId];
        // check sender is owner
        require(submission.submitter == msg.sender);

        // unlock submitter lock
        staking.unlock(submission.submitter, submission.lockId);
        // remove submitter used lock
        delete(usedLocks[submission.submitter][submission.lockId]);
        // delete submission
        delete(submissions[entryId]);
        // remove from registry
        registry.remove(entryId);
    }

    /**
     * @notice Set Voting app
     * @param _voting New Voting app
     */
    function setVotingApp(IVoting _voting) authP(CHANGE_VOTING_APP_ROLE, arr(voting, _voting)) public {
        _setVotingApp(_voting);
    }

    /**
     * @notice Set minimum deposit for Submissions and Challenges to `_minDeposit`. It's the minimum amount of tokens needed for Submissions and Challenges.
     * @param _minDeposit New minimum amount
     */
    function setMinDeposit(uint256 _minDeposit) authP(CHANGE_PARAMS_ROLE, arr(uint256(MIN_DEPOSIT_PARAM), _minDeposit)) public {
        _setMinDeposit(_minDeposit);
    }

    /**
     * @notice Set apply stage length for Submissions to `_applyStageLen`. It's the duration after which an submission gets registered if it doesn't receive any challenge
     * @param _applyStageLen New apply stage length
     */
    function setApplyStageLen(uint64 _applyStageLen) authP(CHANGE_PARAMS_ROLE, arr(uint256(APPLY_STAGE_LEN_PARAM), _applyStageLen)) public {
        _setApplyStageLen(_applyStageLen);
    }

    /**
     * @notice Set dispensation percetage parameter for Submissions and Challenges to `_dispensationPct`. It's the percentage of deposited tokens awarded to the winning party (submitter or challenger). The rest will be distributed among voters.
     * @param _dispensationPct New dispensation percentage
     */
    function setDispensationPct(uint256 _dispensationPct)
        authP(CHANGE_PARAMS_ROLE, arr(uint256(DISPENSATION_PCT_PARAM), _dispensationPct))
        public
    {
        require(_dispensationPct <= PCT_BASE);

        _setDispensationPct(_dispensationPct);
    }

    /**
     * @notice Check if submission for entry with id `entryId` has gone through apply stage period without any challenge and therefore can be registered.
     * @param entryId Id of the Submission
     */
    function canBeRegistered(bytes32 entryId) view public returns (bool) {
        if (getTimestamp64() > submissions[entryId].date.add(applyStageLen) &&
            !challengeExists(entryId))
        {
            return true;
        }

        return false;
    }

    /**
     * @notice Get Submission details
     * @param entryId Id of the Submission
     * @return submitter Address of submitter
     * @return date Date of Submission
     * @return registered Whether has been already registered or not
     * @return data Content of the Submission
     * @return amount Diposited (staked and locked) amount
     * @return lockId Id of the lock for the deposit in Staking app
     */
    function getSubmission(
        bytes32 entryId
    )
        view
        public
        returns (
            address submitter,
            uint64 date,
            bool registered,
            bytes data,
            uint256 amount,
            uint256 lockId
        )
    {
        Submission memory submission = submissions[entryId];
        return (
            submission.submitter,
            submission.date,
            submission.registered,
            submission.data,
            submission.amount,
            submission.lockId
        );
    }

    /**
     * @notice Get Challenge details for entry with id `entryId`
     * @param entryId Id of the Submission
     * @return challenger Address of challenger
     * @return date Date of Challenge
     * @return amount Diposited (staked and locked) amount
     * @return lockId Id of the lock for the deposit in Staking app
     * @return voteId Id of the Vote for the Challenge in Voting app
     * @return dispensation Dispensation Percentage parameter at the time of challenging
     */
    function getChallenge(
        bytes32 entryId
    )
        view
        public
        returns (
            address challenger,
            uint64 date,
            uint256 amount,
            uint256 lockId,
            uint256 voteId,
            uint256 dispensation
        )
    {
        Challenge memory challenge = challenges[entryId];
        return (
            challenge.challenger,
            challenge.date,
            challenge.amount,
            challenge.lockId,
            challenge.voteId,
            challenge.dispensationPct
        );
    }

    /**
     * @notice Get Vote details for Vote with id `voteId`
     * @param voteId Id of the Vote
     * @return closed Wheter the Vote has been already closed or not
     * @return result The result of the Vote
     * @return totalWinningStake Amount of tokens on the winning side
     * @return votersRewardPool The total amount that will be redistributed to the voters on the winning side.
     */
    function getVote(
        uint256 voteId
    )
        view
        public
        returns (
            bool closed,
            bool result,
            uint256 totalWinningStake,
            uint256 votersRewardPool
        )
    {
        Vote memory vote = votes[voteId];
        return (
            vote.closed,
            vote.result,
            vote.totalWinningStake,
            vote.votersRewardPool
        );
    }

    function _checkLock(address user, uint256 lockId, uint64 endDate) internal returns (uint256) {
        // get the lock
        uint256 amount;
        uint64 unlockedAt;
        address unlocker;
        (amount, unlockedAt, unlocker, ) = staking.getLock(msg.sender, lockId);
        // check lockId was not used before
        require(!usedLocks[user][lockId]);
        // check unlocker
        require(unlocker == address(this));
        // check enough amount
        require(amount >= minDeposit);
        // check is not unlocked
        require(unlockedAt >= endDate);

        // mark it as used
        usedLocks[user][lockId] = true;

        return amount;
    }

    function _setVotingApp(IVoting _voting) internal {
        require(isContract(address(_voting)));

        voting = _voting;
    }

    function _setMinDeposit(uint256 _minDeposit) internal {
        minDeposit = _minDeposit;
    }

    function _setApplyStageLen(uint64 _applyStageLen) internal {
        applyStageLen = _applyStageLen;
    }

    function _setDispensationPct(uint256 _dispensationPct) internal {
        dispensationPct = _dispensationPct;
    }

    function submissionExists(bytes32 entryId) view internal returns (bool) {
        return submissions[entryId].data.length > 0;
    }

    function challengeExists(bytes32 entryId) view internal returns (bool) {
        return challenges[entryId].challenger != address(0);
    }
}
