pragma solidity 0.4.18;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/misc/Migrations.sol";
import "@aragon/os/contracts/lib/zeppelin/math/SafeMath.sol";
import "@aragon/os/contracts/lib/zeppelin/math/SafeMath64.sol";

import "@aragon/apps-staking/contracts/interfaces/IStaking.sol";
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
    IStaking public staking;
    IVoting public voting;
    uint256 public minDeposit;
    uint64 public applyStageLen;
    uint256 public dispensationPct;

    bytes32 constant public CHANGE_PARAMS_ROLE = keccak256("CHANGE_PARAMS_ROLE");
    bytes32 constant public CHANGE_VOTING_APP_ROLE = keccak256("CHANGE_VOTING_APP_ROLE");

    // TODO!!!
    enum TimeUnit { Blocks, Seconds }

    struct Application {
        address applicant;
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

    mapping(bytes32 => Application) applications;
    mapping(bytes32 => Challenge) challenges;
    mapping(uint256 => Vote) votes;
    mapping(address => mapping(uint256 => bool)) usedLocks;

    event NewApplication(bytes32 indexed entryId, address applicant);
    event NewChallenge(bytes32 indexed entryId, address challenger);
    event ResolvedChallenge(bytes32 indexed entryId, bool result);

    /**
     * @notice Initializes Curation app with
     * @param _registry Registry app to be used for registering accepted entries
     * @param _staking Staking app to be used for staking and locking tokens
     * @param _voting Voting app to be used for Challenges
     * @param _minDeposit Minimum amount of tokens needed for Applications and Challenges
     * @param _applyStageLen Duration after which an application gets registered if it doesn't receive any challenge
     * @param _dispensationPct Percentage of deposited tokens awarded to the winning party (applicant or challenger). The rest will be distributed among voters
     */
    function initialize(
        IRegistry _registry,
        IStaking _staking,
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
     * @notice Submit new application for "`data`" using lock `lockId`
     * @param data Content of the application
     * @param lockId Id of the lock from Staking app used for the application
     * @return Id of the new entry
     */
    function newApplication(bytes data, uint256 lockId) isInitialized public returns (bytes32 entryId) {
        entryId = keccak256(data);

        require(data.length != 0);
        // check data doesn't have an ongoing application
        require(!applicationExists(entryId));
        // check data doesn't exist in Registry
        require(!registry.exists(entryId));

        // check locked tokens
        uint256 amount = _checkLock(msg.sender, lockId, MAX_UINT64);

        applications[entryId] = Application({
            applicant: msg.sender,
            date: getTimestamp(),
            registered: false,
            data: data,
            amount: amount,
            lockId: lockId
        });

        // register used lock
        NewApplication(entryId, msg.sender);
    }

    /**
     * @notice Challenge application for entry with id `entryId` using lock wiht id `lockId`
     * @param entryId Id of the application being challenged
     * @param lockId Id of the lock from Staking app used for the application
     * @return Id of the Challenge, which is the same as the Application one
     */
    function challengeApplication(bytes32 entryId, uint256 lockId) isInitialized public returns(bytes32) {
        // check application doesn't have an ongoing challenge
        require(!challengeExists(entryId));

        // touch-and-remove case
        Application memory application = applications[entryId];
        if (application.amount < minDeposit) {
            staking.unlock(application.applicant, application.lockId);
            delete(applications[entryId]);
            registry.remove(entryId);
            return 0;
        }

        // check locked tokens
        uint256 amount = _checkLock(msg.sender, lockId, getTimestamp().add(applyStageLen));

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
            date: getTimestamp(),
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

        NewChallenge(entryId, msg.sender);

        return entryId;
    }

    /**
     * @notice Resolve Challenge for entry with id `entryId`
     * @param entryId Id of the Application/Challenge
     */
    function resolveChallenge(bytes32 entryId) isInitialized public {
        require(challengeExists(entryId));
        Challenge storage challenge = challenges[entryId];
        Application storage application = applications[entryId];
        Vote storage vote = votes[challenge.voteId];

        require(voting.isClosed(challenge.voteId));
        vote.closed = true;
        (vote.result, vote.totalWinningStake,) = voting.getVoteResult(challenge.voteId);

        address winner;
        address loser;
        uint256 loserLockId;
        uint256 amount;
        if (vote.result == false) { // challenge not accepted (application remains)
            winner = application.applicant;
            loser = challenge.challenger;
            loserLockId = challenge.lockId;
            amount = challenge.amount;

            // it's still in application phase (not registered yet)
            if (!application.registered) {
                application.registered = true;
                // insert in Registry app
                registry.add(application.data);
            }
        } else { // challenge accepted (application rejected)
            winner = challenge.challenger;
            loser = application.applicant;
            loserLockId = application.lockId;
            amount = application.amount;

            // Remove from Registry app
            application.registered = false;
            registry.remove(entryId);
        }
        // compute rewards
        uint256 reward = amount.mul(dispensationPct) / PCT_BASE;
        vote.votersRewardPool = amount - reward;

        // unlock tokens from Staking app
        staking.unlock(application.applicant, application.lockId);
        staking.unlock(challenge.challenger, challenge.lockId);

        // redistribute tokens
        staking.moveTokens(loser, winner, reward);
        staking.moveTokens(loser, address(this), vote.votersRewardPool);

        // Remove used locks
        delete(usedLocks[application.applicant][application.lockId]);
        delete(usedLocks[challenge.challenger][challenge.lockId]);

        // Remove challenge, and application if needed
        if (vote.result == true) {
            delete(applications[entryId]);
        }
        delete(challenges[entryId]);

        ResolvedChallenge(entryId, vote.result);
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
        staking.moveTokens(address(this), msg.sender, reward);
    }

    /**
     * @notice Register unchallenged application with id `entryId`
     * @param entryId Id of the Application
     */
    function registerUnchallengedApplication(bytes32 entryId) isInitialized public {
        require(canBeRegistered(entryId));

        Application storage application = applications[entryId];
        require(!application.registered);
        application.registered = true;

        // insert in Registry app
        registry.add(application.data);
    }

    /**
     * @notice Remove Application with id `entryId` by applicant, and unlock deposit
     * @param entryId Id of the Application
     */
    function removeApplication(bytes32 entryId) isInitialized public {
        // check application doesn't have an ongoing challenge
        require(!challengeExists(entryId));

        Application memory application = applications[entryId];
        // check sender is owner
        require(application.applicant == msg.sender);

        // unlock applicant lock
        staking.unlock(application.applicant, application.lockId);
        // remove applicant used lock
        delete(usedLocks[application.applicant][application.lockId]);
        // delete application
        delete(applications[entryId]);
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
     * @notice Set minimum deposit for Applications and Challenges to `_minDeposit`. It's the minimum amount of tokens needed for Applications and Challenges.
     * @param _minDeposit New minimum amount
     */
    function setMinDeposit(uint256 _minDeposit) authP(CHANGE_PARAMS_ROLE, arr(uint256(MIN_DEPOSIT_PARAM), _minDeposit)) public {
        _setMinDeposit(_minDeposit);
    }

    /**
     * @notice Set apply stage length for Applications to `_applyStageLen`. It's the duration after which an application gets registered if it doesn't receive any challenge
     * @param _applyStageLen New apply stage length
     */
    function setApplyStageLen(uint64 _applyStageLen) authP(CHANGE_PARAMS_ROLE, arr(uint256(APPLY_STAGE_LEN_PARAM), _applyStageLen)) public {
        _setApplyStageLen(_applyStageLen);
    }

    /**
     * @notice Set dispensation percetage parameter for Applications and Challenges to `_dispensationPct`. It's the percentage of deposited tokens awarded to the winning party (applicant or challenger). The rest will be distributed among voters.
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
     * @notice Check if application for entry with id `entryId` has gone through apply stage period without any challenge and therefore can be registered.
     * @param entryId Id of the Application
     */
    function canBeRegistered(bytes32 entryId) view public returns (bool) {
        if (getTimestamp() > applications[entryId].date.add(applyStageLen) &&
            !challengeExists(entryId))
        {
            return true;
        }

        return false;
    }

    /**
     * @notice Get Application details
     * @param entryId Id of the Application
     * @return applicant Address of applicant
     * @return date Date of Application
     * @return registered Whether has been already registered or not
     * @return data Content of the Application
     * @return amount Diposited (staked and locked) amount
     * @return lockId Id of the lock for the deposit in Staking app
     */
    function getApplication(
        bytes32 entryId
    )
        view
        public
        returns (
            address applicant,
            uint64 date,
            bool registered,
            bytes data,
            uint256 amount,
            uint256 lockId
        )
    {
        Application memory application = applications[entryId];
        return (
            application.applicant,
            application.date,
            application.registered,
            application.data,
            application.amount,
            application.lockId
        );
    }

    /**
     * @notice Get Challenge details for entry with id `entryId`
     * @param entryId Id of the Application
     * @return challenger Address of challenger
     * @return date Date of Challenge
     * @return amount Diposited (staked and locked) amount
     * @return lockId Id of the lock for the deposit in Staking app
     * @return voteId Id of the Vote for the Challenge in Voting app
     * @return dispensationPct Dispensation Percentage parameter at the time of challenging
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
            uint256 dispensationPct
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

    function _checkLock(address user, uint256 lockId, uint64 date) internal returns (uint256) {
        // get the lock
        uint256 amount;
        uint8 lockUnit;
        uint64 lockEnds;
        address unlocker;
        (amount, lockUnit, lockEnds, unlocker, ) = staking.getLock(msg.sender, lockId);
        // check lockId was not used before
        require(!usedLocks[user][lockId]);
        // check unlocker
        require(unlocker == address(this));
        // check enough amount
        require(amount >= minDeposit);
        // check time
        require(lockUnit == uint8(TimeUnit.Seconds));
        require(lockEnds >= date);

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

    function applicationExists(bytes32 entryId) view internal returns (bool) {
        return applications[entryId].data.length > 0;
    }

    function challengeExists(bytes32 entryId) view internal returns (bool) {
        return challenges[entryId].challenger != address(0);
    }

    function getTimestamp() view internal returns (uint64) {
        return uint64(now);
    }
}
