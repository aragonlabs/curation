pragma solidity 0.4.18;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/misc/Migrations.sol";
import "@aragon/os/contracts/lib/zeppelin/math/SafeMath.sol";
import "@aragon/os/contracts/lib/zeppelin/math/SafeMath64.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IStaking.sol";
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
        bool resolved;
        uint256 amount;
        uint256 lockId;
        uint256 voteId;
        uint256 dispensationPct;
        mapping(address => bool) claims; // participants who already claimed their reward
    }

    mapping(bytes32 => Application) applications;
    mapping(bytes32 => Challenge) challenges;
    mapping(uint256 => bool) usedLocks;

    event NewApplication(bytes32 entryId, address applicant);
    event NewChallenge(bytes32 entryId, address challenger);
    event ResolvedChallenge(bytes32 entryId, bool result);

    /**
     * @notice Initializes Curation app with
     * @param _registry TODO
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

    function newApplication(bytes data, uint256 lockId) isInitialized public returns (bytes32 entryId) {
        entryId = keccak256(data);

        require(data.length != 0);
        // check data doesn't have an ongoing application
        require(!applicationExists(entryId));
        // check data doesn't exist in Registry
        require(!registry.exists(entryId));

        // check locked tokens
        uint256 amount = _checkLock(lockId, MAX_UINT64);

        applications[entryId] = Application({
            applicant: msg.sender,
            date: uint64(getTimestamp()),
            registered: false,
            data: data,
            amount: amount,
            lockId: lockId
        });

        // register used lock
        NewApplication(entryId, msg.sender);
    }

    function challengeApplication(bytes32 entryId, uint256 lockId) isInitialized public returns(bytes32) {
        // check application doesn't have an ongoing challenge
        require(!challengeExists(entryId));
        // check locked tokens
        uint256 amount = _checkLock(lockId, uint64(getTimestamp()).add(applyStageLen));

        // touch-and-remove case
        Application memory application = applications[entryId];
        if (application.amount < minDeposit) {
            registry.remove(entryId);
            staking.unlock(application.applicant, application.lockId);
            staking.unlock(msg.sender, lockId);
            return 0;
        }

        // create vote
        // TODO: script
        // TODO: metadata
        uint256 voteId = voting.newVote("", "");

        challenges[entryId] = Challenge({
            challenger: msg.sender,
            date: uint64(getTimestamp()),
            resolved: false,
            amount: amount,
            lockId: lockId,
            voteId: voteId,
            dispensationPct: dispensationPct
        });

        NewChallenge(entryId, msg.sender);

        return entryId;
    }

    function resolveChallenge(bytes32 entryId) isInitialized public {
        Challenge storage challenge = challenges[entryId];
        Application storage application = applications[entryId];

        require(!challenge.resolved);
        // TODO: canExecute??
        require(voting.isClosed(challenge.voteId));

        bool voteResult;
        (voteResult,,) = voting.getVoteResult(challenge.voteId);

        uint256 reward;
        if (voteResult == false) { // challenge not accepted (application remains)
            // it's still in application phase (not registered yet)
            if (!application.registered) {
                // insert in Registry app
                registry.add(application.data);
                application.registered = true;
            }
            // Remove applicant used lock
            delete(usedLocks[application.lockId]);
            // Unlock challenger tokens from Staking app
            reward = challenge.amount.mul(dispensationPct) / PCT_BASE;
            // Redistribute tokens
            staking.unlockAndMoveTokens(challenge.lockId, challenge.challenger, application.applicant, reward);
        } else { // challenge accepted (application rejected)
            // it has been already registered
            if (application.registered) {
                // remove from Registry app
                registry.remove(entryId);
                application.registered = false;
            }
            // Remove challenger used lock
            delete(usedLocks[challenge.lockId]);
            // Unlock applicant tokens from Staking app
            reward = application.amount.mul(dispensationPct) / PCT_BASE;
            // Redistribute tokens
            staking.unlockAndMoveTokens(application.lockId, application.applicant, challenge.challenger, reward);
        }

        challenge.resolved = true;
        ResolvedChallenge(entryId, voteResult);
    }

    function claimReward(bytes32 entryId) isInitialized public {
        require(isChallengeResolved(entryId));

        Challenge storage challenge = challenges[entryId];
        Application memory application = applications[entryId];

        // avoid claiming twice
        require(!challenge.claims[msg.sender]);

        bool voteResult;
        uint256 totalWinningStake;
        (voteResult, totalWinningStake,) = voting.getVoteResult(challenge.voteId);

        address loser;
        uint256 loserLockId;
        if (voteResult == false) {
            loser = challenge.challenger;
            loserLockId = challenge.lockId;
        } else { // voteResult == true
            loser = application.applicant;
            loserLockId = application.lockId;
        }

        // reward as a voter
        uint256 voterWinningStake = voting.getVoterWinningStake(challenge.voteId, msg.sender);
        require(voterWinningStake > 0);
        // amount * (voter / total) * (1 - dispensationPct)
        uint256 reward = challenge.amount.mul(voterWinningStake).mul(PCT_BASE.sub(dispensationPct)) / (totalWinningStake * PCT_BASE);
        // Redistribute tokens
        staking.unlockAndMoveTokens(loserLockId, loser, msg.sender, reward);

        // check if lock can be released
        uint256 amount;
        (amount, ) = staking.getLock(loser, loserLockId);
        if (amount == 0) { // TODO: with truncating, this may never happen!!
            delete(usedLocks[loserLockId]);
            // Remove application, if it lost, as redistribution is done
            if (voteResult == true) {
                delete(applications[entryId]);
            }
        }

        // register claim to avoid claiming it again
        challenge.claims[msg.sender] = true;
    }

    function registerApplication(bytes32 entryId) isInitialized public {
        require(canBeRegistered(entryId));

        Application storage application = applications[entryId];
        require(!application.registered);

        // insert in Registry app
        registry.add(application.data);
        application.registered = true;
    }

    function setVotingApp(IVoting _voting) authP(CHANGE_VOTING_APP_ROLE, arr(voting, _voting)) public {
        _setVotingApp(_voting);
    }

    function setMinDeposit(uint256 _minDeposit) authP(CHANGE_PARAMS_ROLE, arr(uint256(MIN_DEPOSIT_PARAM), _minDeposit)) public {
        _setMinDeposit(_minDeposit);
    }

    function setApplyStageLen(uint64 _applyStageLen) authP(CHANGE_PARAMS_ROLE, arr(uint256(APPLY_STAGE_LEN_PARAM), _applyStageLen)) public {
        _setApplyStageLen(_applyStageLen);
    }

    function setDispensationPct(uint256 _dispensationPct) authP(CHANGE_PARAMS_ROLE, arr(uint256(DISPENSATION_PCT_PARAM), _dispensationPct)) public {
        require(_dispensationPct <= PCT_BASE);

        _setDispensationPct(_dispensationPct);
    }

    function canBeRegistered(bytes32 entryId) view public returns (bool) {
        // no challenges
        if (uint64(getTimestamp()) > applications[entryId].date.add(applyStageLen)
            && challenges[entryId].challenger == address(0) ) {
            return true;
        }

        return false;
    }

    function isChallengeResolved(bytes32 entryId) view public returns (bool) {
        return challenges[entryId].resolved;
    }

    function getApplication(
        bytes32 entryId
    )
        view
        external
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

    function getChallenge(
        bytes32 entryId
    )
        view
        external
        returns (
            address challenger,
            uint64 date,
            bool resolved,
            uint256 amount,
            uint256 lockId,
            uint256 voteId,
            uint256 dipsensationPct
        )
    {
        Challenge memory challenge = challenges[entryId];
        return (
            challenge.challenger,
            challenge.date,
            challenge.resolved,
            challenge.amount,
            challenge.lockId,
            challenge.voteId,
            challenge.dispensationPct
        );
    }

    function _checkLock(uint256 lockId, uint64 date) internal returns (uint256) {
        // check lockId was not used before
        require(!usedLocks[lockId]);
        // get the lock
        uint256 amount;
        uint8 lockUnit;
        uint64 lockEnds;
        address unlocker;
        (amount, lockUnit, lockEnds, unlocker, ) = staking.getLock(msg.sender, lockId);
        // check unlocker
        require(unlocker == address(this));
        // check enough amount
        require(amount >= minDeposit);
        // check time
        require(lockUnit == uint8(TimeUnit.Seconds));
        require(lockEnds >= date);

        // mark it as used
        usedLocks[lockId] = true;

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

    function getTimestamp() view internal returns (uint256) {
        return now;
    }
}
