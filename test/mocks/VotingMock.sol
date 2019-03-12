pragma solidity 0.4.24;

import "../../contracts/interfaces/IVoting.sol";
import "@aragon/os/contracts/apps/AragonApp.sol";


contract VotingMock is IVoting, AragonApp {
    uint256 voteId;
    struct Vote {
        bytes script;
        bool closed; // TODO
        bool result;
        uint256 winningStake;
        uint256 totalStake;
    }
    mapping(uint256 => Vote) votes;
    mapping(address => uint256) voterWinningStake;

    function VotingMock() public {
        voteId = 0;
    }

    function newVote(bytes _executionScript, string _metadata) external returns (uint256) {
        votes[voteId] = Vote(_executionScript, false, false, 0, 0);

        return voteId;
    }

    function setVoteClosed(uint256 _voteId, bool _closed) public {
        votes[_voteId].closed = _closed;
    }

    function setVoteId(uint256 _voteId) public {
        voteId = _voteId;
    }

    function setVoteResult(uint256 _voteId, bool _result, uint256 _winningStake, uint256 _totalStake) public {
        votes[_voteId].result = _result;
        votes[_voteId].winningStake = _winningStake;
        votes[_voteId].totalStake = _totalStake;
    }

    function setVoterWinningStake(address _voter, uint256 _stake) public {
        voterWinningStake[_voter] = _stake;
    }

    function execute(uint256 _voteId) public {
        runScript(votes[_voteId].script, new bytes(0), new address[](0));
    }

    function isClosed(uint256 _voteId) view public returns (bool) {
        return votes[_voteId].closed;
    }

    function getVoteResult(uint256 _voteId) public returns (bool _result, uint256 _winningStake, uint256 _totalStake) {
        return (votes[_voteId].result, votes[_voteId].winningStake, votes[_voteId].totalStake);
    }

    function getVoterWinningStake(uint256 _voteId, address _voter) public returns (uint256) {
        if (!isClosed(_voteId)) {
            return 0;
        }

        return voterWinningStake[_voter];
    }
}
