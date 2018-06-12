const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const getContract = name => artifacts.require(name)
const getEvent = (receipt, event, arg) => { return receipt.logs.filter(l => l.event == event)[0].args[arg] }
const pct16 = x => new web3.BigNumber(x).times(new web3.BigNumber(10).toPower(16))

contract('Curation', ([owner, applicant, challenger, voter, _]) => {
  let curation, registry, staking, voting, MAX_UINT64
  const minDeposit = 100
  const applyStageLen = 1000
  const dispensationPct = pct16(60)
  const WINNING_STAKE = 70
  const TOTAL_STAKE = 100
  const VOTER_WINNING_STAKE = 10

  const zeroAddress = "0x0000000000000000000000000000000000000000"
  const TIME_UNIT_BLOCKS = 0
  const TIME_UNIT_SECONDS = 1

  context('Regular App', async () => {
    const appLockId = 1
    const challengeLockId = 2
    const voteId = 1
    const data = "Test"

    beforeEach(async () => {
      registry = await getContract('RegistryApp').new()
      staking = await getContract('StakingMock').new()
      voting = await getContract('VotingMock').new()

      curation = await getContract('CurationMock').new()
      MAX_UINT64 = await curation.MAX_UINT64()
      await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
    })

    it('checks initial values are right', async () => {
      assert.equal(await curation.registry(), registry.address, "Registry address should match")
      assert.equal(await curation.staking(), staking.address, "Staking address should match")
      assert.equal(await curation.voting(), voting.address, "Voting address should match")
      assert.equal(await curation.minDeposit(), minDeposit, "minDeposit address should match")
      assert.equal(await curation.applyStageLen(), applyStageLen, "applyStageLen address should match")
      assert.equal((await curation.dispensationPct()).toString(), dispensationPct.toString(), "dispensationPct address should match")
    })

    it('fails on reinitialization', async () => {
      return assertRevert(async () => {
        await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
      })
    })

    // ----------- Create applications --------------

    it('creates new Application', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r, "NewApplication", "applicationId")
      const application = await curation.getApplication(applicationId)
      assert.equal(application[0], applicant, "Applicant should match")
      //assert.equal(application[1], , "Date should match")
      assert.equal(application[2], false, "Registered bool should match")
      assert.equal(application[3], web3.toHex(data), "Data should match")
      assert.equal(application[4], minDeposit, "Amount should match")
      assert.equal(application[5], appLockId, "LockId should match")
    })

    it('fails creating new Application with an already used lock', async () => {
      const data1 = "Test 1"
      const data2 = "Test 2"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      await curation.newApplication(data1, appLockId, { from: applicant })
      // repeat
      return assertRevert(async () => {
        await curation.newApplication(data2, appLockId, { from: applicant })
      })
    })

    it('fails creating new Application with an ongoing application', async () => {
      const lockId1 = 1
      const lockId2 = 2
      const data = "Test"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      await curation.newApplication(data, lockId1, { from: applicant })
      // repeat
      return assertRevert(async () => {
        await curation.newApplication(data, lockId2, { from: applicant })
      })
    })

    it('fails creating new Application with an already registered data', async () => {
      const lockId1 = 1
      const lockId2 = 2
      const data = "Test"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // register data - this won't happen with real app, as ACLs will be working!
      await registry.add(data)
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, lockId2, { from: applicant })
      })
    })

    // ----------- Challenge applications --------------

    const applyAndChallenge = async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      const r1 = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r1, "NewApplication", "applicationId")
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      const r2 = await curation.challengeApplication(applicationId, challengeLockId, { from: challenger })
      const challengeId = getEvent(r2, "NewChallenge", "challengeId")

      return challengeId
    }

    it('challenges application', async () => {
      const challengeId = await applyAndChallenge()
      // checks
      const challenge = await curation.getChallenge(challengeId)
      assert.equal(challenge[0], challenger, "Challenger should match")
      //assert.equal(challenge[1], , "Date should match")
      assert.equal(challenge[2], false, "Resolved bool should match")
      assert.equal(challenge[3], minDeposit, "Amount should match")
      assert.equal(challenge[4], challengeLockId, "LockId should match")
      assert.equal(challenge[5], voteId, "Vote Id should match")
      assert.equal(challenge[6].toString(), dispensationPct.toString(), "Dipsensation Pct should match")
    })

    it('challenges touch-and-remove application', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      const r1 = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r1, "NewApplication", "applicationId")

      // increase minDeposit
      await curation.setMinDeposit(minDeposit + 1)

      // mock lock
      await staking.setLock(minDeposit + 1, TIME_UNIT_SECONDS, (await curation.getTimestampExt()).add(applyStageLen + 1000), curation.address, "")
      // challenge
      const r2 = await curation.challengeApplication(applicationId, challengeLockId, { from: challenger })
      const challenge = await curation.getChallenge(applicationId)
      // no challenge has been created
      assert.equal(challenge[0], zeroAddress, "Challenger should be zero")
      assert.equal(challenge[1], 0, "Date should be zero")
      assert.equal(challenge[2], false, "Resolved should be false")
      assert.equal(challenge[3], 0, "Amount should be zero")
      assert.equal(challenge[4], 0, "LockId should be zero")
      assert.equal(challenge[5], 0, "Vote Id should be zero")
      assert.equal(challenge[6], 0, "Dipsensation Pct should be zero")
    })

    it('fails challenging with an already used lock', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      const r1 = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r1, "NewApplication", "applicationId")
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      return assertRevert(async () => {
        // challenge
        const r2 = await curation.challengeApplication(applicationId, appLockId)
      })
    })

    it('fails challenging an already challenged application', async () => {
      const applicationId = await applyAndChallenge()
      const newChallengeLockId = 3
      // repeat
      return assertRevert(async () => {
        await curation.challengeApplication(applicationId, newChallengeLockId, { from: challenger })
      })
    })

    // ----------- Resolve challenges --------------

    // checks if a log for moving tokens was generated with the given params
    // if amount is 0, it will check for any
    /* this doesn't work, only shows called contract logs
     const checkMovedTokens = (receipt, from, to, amount) => {
     const logs = receipt.logs.filter(
     l =>
     l.event == 'MovedTokens' &&
     l.args['from'] == from &&
     l.args['to'] == to &&
     (l.args['amount'] == amount || amount == 0)
     )
     return logs.length == 1 || (amount == 0 && logs.length >= 1)
     }
     */
    const checkMovedTokens = (receipt, from, to, amount) => {
      const logs = receipt.receipt.logs.filter(
        l =>
          l.topics[0] == web3.sha3('MovedTokens(address,address,uint256)') &&
          '0x' + l.topics[1].slice(26) == from &&
          '0x' + l.topics[2].slice(26) == to &&
          (web3.toDecimal(l.data) == amount || amount == 0)
      )
      return logs.length == 1 || (amount == 0 && logs.length >= 1)
    }

    const applyChallengeAndResolve = async (result) => {
      const applicationId = await applyAndChallenge()
      // mock vote result
      await voting.setVoteClosed(voteId, true)
      await voting.setVoteResult(voteId, result, WINNING_STAKE, TOTAL_STAKE)
      // resolve
      const receipt = await curation.resolveChallenge(applicationId)

      return { applicationId: applicationId, receipt: receipt }
    }

    it('resolves challenge, rejected', async () => {
      const {applicationId, receipt} = await applyChallengeAndResolve(false)
      // checks
      // registry
      assert.isTrue(await registry.exists(applicationId), "Data should have been registered")
      // application
      const application = await curation.getApplication(applicationId)
      assert.isTrue(application[2], "Registered should be true")
      // challenge
      const challenge = await curation.getChallenge(applicationId)
      assert.isTrue(challenge[2], "Resolved should be true")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      assert.isFalse(checkMovedTokens(receipt, applicant, challenger, 0))
      assert.isTrue(checkMovedTokens(receipt, challenger, applicant, amount))
      // used locks
      const appUsedLock = await curation.getUsedLock(appLockId)
      const challengeUsedLock = await curation.getUsedLock(challengeLockId)
      assert.isFalse(appUsedLock)
      assert.isTrue(challengeUsedLock)
    })

    it('resolves challenge, accepted', async () => {
      const {applicationId, receipt} = await applyChallengeAndResolve(true)

      // checks
      // registry
      assert.isFalse(await registry.exists(data), "Data should not have been registered")
      // application
      const application = await curation.getApplication(applicationId)
      assert.isFalse(application[2], "Registered should be false")
      // challenge
      const challenge = await curation.getChallenge(applicationId)
      assert.isTrue(challenge[2], "Resolved should be true")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      assert.isFalse(checkMovedTokens(receipt, challenger, applicant, 0))
      assert.isTrue(checkMovedTokens(receipt, applicant, challenger, amount))
      // used locks
      const appUsedLock = await curation.getUsedLock(appLockId)
      const challengeUsedLock = await curation.getUsedLock(challengeLockId)
      assert.isTrue(appUsedLock)
      assert.isFalse(challengeUsedLock)
    })

    it('fails resolving challenge if vote has not ended', async () => {
      const appLockId = 1
      const challengeLockId = 2
      const voteId = 1
      const data = "Test"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      const r1 = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r1, "NewApplication", "applicationId")
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      await curation.challengeApplication(applicationId, challengeLockId, { from: challenger })
      // mock vote result
      await voting.setVoteClosed(voteId, false)
      // resolve
      return assertRevert(async () => {
        await curation.resolveChallenge(applicationId)
      })
    })

    // ----------- Claim rewards --------------

    it('claims reward as voter in the winning party', async () => {
      const {applicationId} = await applyChallengeAndResolve(true)
      await voting.setVoterWinningStake(voter, VOTER_WINNING_STAKE)
      const receipt = await curation.claimReward(applicationId, { from: voter })
      const reward = new web3.BigNumber(minDeposit).mul(VOTER_WINNING_STAKE).mul(1e18 - dispensationPct).dividedToIntegerBy(WINNING_STAKE).dividedToIntegerBy(1e18)
      assert.isTrue(checkMovedTokens(receipt, applicant, voter, reward), "Reward should be payed")
    })

    it('fails claiming reward if not voter in the winning party', async () => {
      const {applicationId} = await applyChallengeAndResolve(true)
      await voting.setVoterWinningStake(voter, 0)
      return assertRevert(async () => {
        await curation.claimReward(applicationId, { from: voter })
      })

    })

    it('claims reward and lock can be released, challenge rejected', async () => {
      const {applicationId} = await applyChallengeAndResolve(false)
      await voting.setVoterWinningStake(voter, VOTER_WINNING_STAKE)
      // mock Staking to pretend losing party tokens were already distributed
      await staking.setLock(0, TIME_UNIT_SECONDS, (await curation.getTimestampExt()).add(applyStageLen + 1000), curation.address, "")
      // claim reward
      const receipt = await curation.claimReward(applicationId, { from: voter })
      const reward = new web3.BigNumber(minDeposit).mul(VOTER_WINNING_STAKE).mul(1e18 - dispensationPct).dividedToIntegerBy(WINNING_STAKE).dividedToIntegerBy(1e18)
      assert.isTrue(checkMovedTokens(receipt, challenger, voter, reward), "Reward should be payed")
      const appUsedLock = await curation.getUsedLock(appLockId)
      const challengeUsedLock = await curation.getUsedLock(challengeLockId)
      assert.isFalse(appUsedLock)
      assert.isFalse(challengeUsedLock)
    })

    it('claims reward and lock can be released, challenge accepted', async () => {
      const {applicationId} = await applyChallengeAndResolve(true)
      await voting.setVoterWinningStake(voter, VOTER_WINNING_STAKE)
      // mock Staking to pretend losing party tokens were already distributed
      await staking.setLock(0, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // claim reward
      const receipt = await curation.claimReward(applicationId, { from: voter })
      const reward = new web3.BigNumber(minDeposit).mul(VOTER_WINNING_STAKE).mul(1e18 - dispensationPct).dividedToIntegerBy(WINNING_STAKE).dividedToIntegerBy(1e18)
      assert.isTrue(checkMovedTokens(receipt, applicant, voter, reward), "Reward should be payed")
      const application = await curation.getApplication(applicationId)
      assert.equal(application[0], zeroAddress, "Application should be empty")
      const appUsedLock = await curation.getUsedLock(appLockId)
      const challengeUsedLock = await curation.getUsedLock(challengeLockId)
      assert.isFalse(appUsedLock)
      assert.isFalse(challengeUsedLock)
    })

    it('fails claiming reward if challenge is not resolved', async () => {
      const applicationId = await applyAndChallenge()
      return assertRevert(async () => {
        await curation.claimReward(applicationId, { from: challenger })
      })
    })

    it('fails claiming a reward twice', async () => {
      const {applicationId} = await applyChallengeAndResolve(true)
      await voting.setVoterWinningStake(voter, VOTER_WINNING_STAKE)
      await curation.claimReward(applicationId, { from: voter })
      return assertRevert(async () => {
        await curation.claimReward(applicationId, { from: voter })
      })
    })

    // ----------- Register applications --------------

    it('registers application after stage period with no challenge', async () => {
      const appLockId = 1
      const data = "Test"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r, "NewApplication", "applicationId")

      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      await curation.registerApplication(applicationId)

      // checks
      // registry
      assert.isTrue(await registry.exists(applicationId), "Data should have been registered")
      // application
      const application = await curation.getApplication(applicationId)
      assert.isTrue(application[2], "Registered should be true")
    })

    it('fails registering an application if time has not gone by', async () => {
      const appLockId = 1
      const data = "Test"
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r, "NewApplication", "applicationId")

      // make sure time has not gone by
      const application = await curation.getApplication(applicationId)
      await curation.setTimestamp(application[1])

      // register
      return assertRevert(async () => {
        await curation.registerApplication(applicationId)
      })
    })

    it('fails registering an application if it has a challenge', async () => {
      const appLockId = 1
      const data = "Test"
      const challengeLockId = 2
      const voteId = 1
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const applicationId = getEvent(r, "NewApplication", "applicationId")

      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      const r2 = await curation.challengeApplication(applicationId, challengeLockId, { from: challenger })

      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      return assertRevert(async () => {
        await curation.registerApplication(applicationId)
      })
    })

    // ----------- Modify parameters --------------

    it('changes voting app', async () => {
      const newVoting = await getContract('VotingMock').new()
      await curation.setVotingApp(newVoting.address)
      assert.equal(await curation.voting(), newVoting.address, "Voting app should match")
    })

    it('fails changing voting app if it is not a contract', async () => {
      return assertRevert(async () => {
        await curation.setVotingApp(applicant)
      })
    })

    it('changes min deposit', async () => {
      const newMinDeposit = minDeposit + 1
      await curation.setMinDeposit(newMinDeposit)
      assert.equal(await curation.minDeposit(), newMinDeposit, "MinDeposit should match")
    })

    it('changes apply stage len', async () => {
      const newApplyStageLen = applyStageLen + 1
      await curation.setApplyStageLen(newApplyStageLen)
      assert.equal(await curation.applyStageLen(), newApplyStageLen, "ApplyStageLen should match")
    })

    it('changes dispensation pct', async () => {
      const newDispensationPct = dispensationPct.plus(1)
      await curation.setDispensationPct(newDispensationPct)
      assert.equal((await curation.dispensationPct()).toString(), newDispensationPct.toString(), "DispensationPct should match")
    })

    it('fails changing dispensation pct if is more 100%', async () => {
      const newDispensationPct = pct16(100) + 1
      return assertRevert(async () => {
        await curation.setDispensationPct(newDispensationPct)
      })
    })
  })

  context('Without init', async () => {
    beforeEach(async () => {
      registry = await getContract('RegistryApp').new()
      staking = await getContract('StakingMock').new()
      voting = await getContract('VotingMock').new()

      curation = await getContract('Curation').new()
    })

    it('fails creating new application', async () => {
      const lockId = 1
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      return assertRevert(async () => {
        await curation.newApplication("test", lockId)
      })
    })

    it('fails challenging', async () => {
      const applicationId = 1
      const lockId = 1
      return assertRevert(async () => {
        await curation.challengeApplication(applicationId, lockId)
      })
    })

    it('fails resolving a challenge', async () => {
      return assertRevert(async () => {
        const challengeId = 1
        await curation.resolveChallenge(challengeId)
      })
    })

    it('fails registering an application', async () => {
      return assertRevert(async () => {
        const applicationId = 1
        await curation.registerApplication(applicationId)
      })
    })

    it('fails claiming reward', async () => {
      return assertRevert(async () => {
        const challengeId = 1
        await curation.claimReward(challengeId)
      })
    })

    it('fails trying to init with empty registry', async () => {
      return assertRevert(async () => {
        await curation.initialize("0x0", staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
      })
    })

    it('fails trying to init with empty staking', async () => {
      return assertRevert(async () => {
        await curation.initialize(registry.address, "0x0", voting.address, minDeposit, applyStageLen, dispensationPct)
      })
    })

    it('fails trying to init with empty voting', async () => {
      return assertRevert(async () => {
        await curation.initialize(registry.address, staking.address, "0x0", minDeposit, applyStageLen, dispensationPct)
      })
    })
  })
})
