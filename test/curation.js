const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const { checkUnlocked, checkMovedTokens } = require('./helpers.js')

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
      await voting.setVoteId(voteId)

      curation = await getContract('CurationMock').new()
      MAX_UINT64 = await curation.MAX_UINT64()
      await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
    })

    it('checks initial values are right', async () => {
      assert.equal(await curation.registry(), registry.address, "Registry address should match")
      assert.equal(await curation.staking(), staking.address, "Staking address should match")
      assert.equal(await curation.voting(), voting.address, "Voting address should match")
      assert.equal(await curation.minDeposit(), minDeposit, "minDeposit should match")
      assert.equal(await curation.applyStageLen(), applyStageLen, "applyStageLen should match")
      assert.equal((await curation.dispensationPct()).toString(), dispensationPct.toString(), "dispensationPct should match")
    })

    it('fails on reinitialization', async () => {
      return assertRevert(async () => {
        await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
      })
    })

    // ----------- Create applications --------------

    const createApplication = async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const entryId = getEvent(r, "NewApplication", "entryId")

      return entryId
    }

    it('creates new Application', async () => {
      const entryId = await createApplication()
      const application = await curation.getApplication.call(entryId)
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
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // register data - this won't happen with real app, as ACLs will be working!
      await registry.add(data)
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, lockId2, { from: applicant })
      })
    })

    it('fails creating new Application with an empty data', async () => {
      const lockId1 = 1
      const lockId2 = 2
      const emptyData = ""
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // register data - this won't happen with real app, as ACLs will be working!
      await registry.add(data)
      // create application
      return assertRevert(async () => {
        await curation.newApplication(emptyData, lockId2, { from: applicant })
      })
    })

    it('fails creating new Application if Curation is not unlocker', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, owner, "")
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, appLockId, { from: applicant })
      })
    })

    it('fails creating new Application if lock deposit is not enough', async () => {
      // mock lock
      await staking.setLock(minDeposit - 1, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, appLockId, { from: applicant })
      })
    })

    it('fails creating new Application if lock time unit is not seconds', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS + 1, MAX_UINT64, curation.address, "")
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, appLockId, { from: applicant })
      })
    })

    it('fails creating new Application if lock time is not enough', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64 - 1, curation.address, "")
      // create application
      return assertRevert(async () => {
        await curation.newApplication(data, appLockId, { from: applicant })
      })
    })

    // ----------- Challenge applications --------------

    const applyAndChallenge = async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      const r = await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      const challengeId = getEvent(r, "NewChallenge", "entryId")
      assert.equal(challengeId, entryId, "A NewChallenge event for the same entryId should have been generated")

      return entryId
    }

    it('challenges application', async () => {
      const entryId = await applyAndChallenge()
      // checks
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], challenger, "Challenger should match")
      //assert.equal(challenge[1], , "Date should match")
      assert.equal(challenge[2], minDeposit, "Amount should match")
      assert.equal(challenge[3], challengeLockId, "LockId should match")
      assert.equal(challenge[4], voteId, "Vote Id should match")
      assert.equal(challenge[5].toString(), dispensationPct.toString(), "Dispensation Pct should match")
      // vote
      const vote = await curation.getVote.call(entryId)
      assert.equal(vote[0], false, "Closed bool should match")
      assert.equal(vote[1], false, "Result bool should match")
      assert.equal(vote[2], 0, "Total winning stake Pct should match")
      assert.equal(vote[3], 0, "Voters reward pool Pct should match")
    })

    it('challenges touch-and-remove application', async () => {
      const entryId = await createApplication()

      // increase minDeposit
      await curation.setMinDeposit(minDeposit + 1)

      // mock lock - no need for lock
      await staking.setLock(0, TIME_UNIT_SECONDS, 0, zeroAddress, "")
      // challenge
      const receipt = await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      // no challenge has been created
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], zeroAddress, "Challenge should be empty")
      // application has been removed
      const application = await curation.getApplication.call(entryId)
      assert.equal(application[0], zeroAddress, "Applicant should be empty")
      // applicant lock has been unlocked
      assert.isTrue(checkUnlocked(receipt, applicant, curation.address, appLockId), "Applicant lock should have been unlocked")
    })

    it('fails challenging with an already used lock', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // use challenger's lock for an application
      await curation.newApplication("test 2", appLockId, { from: challenger })
      // mock vote Id
      await voting.setVoteId(voteId)
      return assertRevert(async () => {
        // challenge, using the same lock as for the application
        await curation.challengeApplication(entryId, appLockId, { from: challenger })
      })
    })

    it('fails challenging an already challenged application', async () => {
      const entryId = await applyAndChallenge()
      const newChallengeLockId = 3
      // repeat
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, newChallengeLockId, { from: challenger })
      })
    })

    it('fails challenging application if Curation is not unlocker', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), owner, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      })
    })

    it('fails challenging application if lock deposit is not enough', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit - 1, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      })
    })

    it('fails challenging application if lock time unit is not seconds', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS + 1, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      })
    })

    it('fails challenging application if lock time is not enough', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen - 1), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      })
    })

    // ----------- Resolve challenges --------------

    const applyChallengeAndResolve = async (result) => {
      const entryId = await applyAndChallenge()
      // mock vote result
      await voting.setVoteClosed(voteId, true)
      await voting.setVoteResult(voteId, result, WINNING_STAKE, TOTAL_STAKE)
      // resolve
      const receipt = await curation.resolveChallenge(entryId)

      return { entryId: entryId, receipt: receipt }
    }

    it('resolves application challenge, rejected', async () => {
      const {entryId, receipt} = await applyChallengeAndResolve(false)
      // checks
      // registry
      assert.isTrue(await registry.exists(entryId), "Data should have been registered")
      // application
      const application = await curation.getApplication.call(entryId)
      assert.isTrue(application[2], "Registered should be true")
      // challenge
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], zeroAddress, "Challenge should be empty")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      assert.isFalse(checkMovedTokens(receipt, applicant, challenger, 0))
      assert.isTrue(checkMovedTokens(receipt, challenger, applicant, amount))
      // used locks
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      const challengeUsedLock = await curation.getUsedLock.call(challenger, challengeLockId)
      assert.isFalse(appUsedLock, "There should be no lock for application")
      assert.isFalse(challengeUsedLock, "There should be no lock for challenge")
    })

    it('resolves application challenge, accepted', async () => {
      const {entryId, receipt} = await applyChallengeAndResolve(true)

      // checks
      // registry
      assert.isFalse(await registry.exists(data), "Data should not have been registered")
      // application
      const application = await curation.getApplication.call(entryId)
      assert.equal(application[0], zeroAddress, "Application should be empty")
      // challenge
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], zeroAddress, "Challenge should be empty")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      const votersRewardPool = new web3.BigNumber(minDeposit).minus(amount)
      assert.isTrue(checkUnlocked(receipt, applicant, curation.address, appLockId), "Applicant lock should have been unlocked")
      assert.isTrue(checkUnlocked(receipt, challenger, curation.address, challengeLockId), "Challenger lock should have been unlocked")
      assert.isFalse(checkMovedTokens(receipt, challenger, applicant, 0), "No challenger tokens should have been moved")
      assert.isTrue(checkMovedTokens(receipt, applicant, challenger, amount), "Applicant tokens should have been moved to challenger")
      assert.isTrue(checkMovedTokens(receipt, applicant, curation.address, votersRewardPool), "Applicant tokens should have been moved to Curation app")
      // used locks
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      const challengeUsedLock = await curation.getUsedLock.call(challenger, challengeLockId)
      assert.isFalse(appUsedLock, "There should be no lock for application")
      assert.isFalse(challengeUsedLock, "There should be no lock for challenge")
    })

    const applyRegisterChallengeAndResolve = async (result) => {
      const entryId = await createApplication()
      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      await curation.registerUnchallengedApplication(entryId)

      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      const r = await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      const challengeId = getEvent(r, "NewChallenge", "entryId")
      assert.equal(challengeId, entryId, "A NewChallenge event for the same entryId should have been generated")

      // mock vote result
      await voting.setVoteClosed(voteId, true)
      await voting.setVoteResult(voteId, result, WINNING_STAKE, TOTAL_STAKE)
      // resolve
      const receipt = await curation.resolveChallenge(entryId)

      return { entryId: entryId, receipt: receipt }
    }

    it('resolves registry challenge, rejected', async () => {
      const {entryId, receipt} = await applyRegisterChallengeAndResolve(false)
      // checks
      // registry
      assert.isTrue(await registry.exists(entryId), "Data should still be registered")
      // application
      const application = await curation.getApplication.call(entryId)
      assert.isTrue(application[2], "Registered should be true")
      // challenge
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], zeroAddress, "Challenge should be empty")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      const votersRewardPool = new web3.BigNumber(minDeposit).minus(amount)
      assert.isTrue(checkUnlocked(receipt, applicant, curation.address, appLockId), "Applicant lock should have been unlocked")
      assert.isTrue(checkUnlocked(receipt, challenger, curation.address, challengeLockId), "Challenger lock should have been unlocked")
      assert.isFalse(checkMovedTokens(receipt, applicant, challenger, 0), "No Applicant tokens should have been moved")
      assert.isTrue(checkMovedTokens(receipt, challenger, applicant, amount), "Challenger tokens should have been moved to Applicant")
      assert.isTrue(checkMovedTokens(receipt, challenger, curation.address, votersRewardPool), "Challenger tokens should have been moved to Curation app")
      // used locks
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      const challengeUsedLock = await curation.getUsedLock.call(challenger, challengeLockId)
      assert.isFalse(appUsedLock, "There should be no lock for application")
      assert.isFalse(challengeUsedLock, "There should be no lock for challenge")
    })

    it('resolves registry challenge, accepted', async () => {
      const {entryId, receipt} = await applyRegisterChallengeAndResolve(true)

      // checks
      // registry
      assert.isFalse(await registry.exists(data), "Data should have been removed from register")
      // application
      const application = await curation.getApplication.call(entryId)
      assert.equal(application[0], zeroAddress, "Application should be empty")
      // challenge
      const challenge = await curation.getChallenge.call(entryId)
      assert.equal(challenge[0], zeroAddress, "Challenge should be empty")
      // redistribution
      const amount = new web3.BigNumber(minDeposit).mul(dispensationPct).dividedToIntegerBy(1e18)
      assert.isFalse(checkMovedTokens(receipt, challenger, applicant, 0), "challenger tokens should have been moved")
      assert.isTrue(checkMovedTokens(receipt, applicant, challenger, amount, "applicant tokens should have been moved"))
      // used locks
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      const challengeUsedLock = await curation.getUsedLock.call(challenger, challengeLockId)
      assert.isFalse(appUsedLock, "There should be no lock for application")
      assert.isFalse(challengeUsedLock, "There should be no lock for challenge")
    })

    it('fails resolving challenge if vote has not ended', async () => {
      const entryId = await createApplication()
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      await curation.challengeApplication(entryId, challengeLockId, { from: challenger })
      // mock vote result
      await voting.setVoteClosed(voteId, false)
      // resolve
      return assertRevert(async () => {
        await curation.resolveChallenge(entryId)
      })
    })

    it('fails resolving application challenge twice', async () => {
      const {entryId, receipt} = await applyChallengeAndResolve(false)
      // mock vote result
      await voting.setVoteClosed(voteId, true)
      await voting.setVoteResult(voteId, false, WINNING_STAKE, TOTAL_STAKE)
      // resolve again
      return assertRevert(async () => {
        await curation.resolveChallenge(entryId)
      })
    })

    // ----------- Claim rewards --------------

    const claimReward = async (result) => {
      const {entryId} = await applyChallengeAndResolve(result)
      await voting.setVoterWinningStake(voter, VOTER_WINNING_STAKE)

      // claim reward
      const receipt = await curation.claimReward(voteId, { from: voter })
      const reward = new web3.BigNumber(minDeposit).mul(VOTER_WINNING_STAKE).mul(1e18 - dispensationPct).dividedToIntegerBy(WINNING_STAKE).dividedToIntegerBy(1e18)
      return {
        entryId: entryId,
        receipt: receipt,
        reward: reward
      }
    }

    it('claims reward as voter in the winning party', async () => {
      const {receipt, reward} = await claimReward(true)
      assert.isTrue(checkMovedTokens(receipt, curation.address, voter, reward), "Reward should be payed")
    })

    it('fails claiming reward if not voter in the winning party', async () => {
      const {entryId} = await applyChallengeAndResolve(true)
      await voting.setVoterWinningStake(voter, 0)
      return assertRevert(async () => {
        await curation.claimReward(voteId, { from: voter })
      })

    })

    it('fails claiming reward if challenge is not resolved', async () => {
      const entryId = await applyAndChallenge()
      return assertRevert(async () => {
        await curation.claimReward(voteId, { from: challenger })
      })
    })

    it('fails claiming a reward twice', async () => {
      const {entryId} = await claimReward(true)
      return assertRevert(async () => {
        await curation.claimReward(voteId, { from: voter })
      })
    })

    // ----------- Register applications --------------

    it('registers application after stage period with no challenge', async () => {
      const entryId = await createApplication()

      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      await curation.registerUnchallengedApplication(entryId)

      // checks
      // registry
      assert.isTrue(await registry.exists(entryId), "Data should have been registered")
      // application
      const application = await curation.getApplication.call(entryId)
      assert.isTrue(application[2], "Registered should be true")
    })

    it('fails registering an application if time has not gone by', async () => {
      const entryId = await createApplication()

      // make sure time has not gone by
      const application = await curation.getApplication.call(entryId)
      await curation.setTimestamp(application[1])

      // register
      return assertRevert(async () => {
        await curation.registerUnchallengedApplication(entryId)
      })
    })

    it('fails registering an application if it has a challenge', async () => {
      const entryId = await createApplication()

      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, (await curation.getTimestampExt.call()).add(applyStageLen + 1000), curation.address, "")
      // mock vote Id
      await voting.setVoteId(voteId)
      // challenge
      await curation.challengeApplication(entryId, challengeLockId, { from: challenger })

      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      return assertRevert(async () => {
        await curation.registerUnchallengedApplication(entryId)
      })
    })

    it('fails registering an application twice', async () => {
      const entryId = await createApplication()

      // time travel
      await curation.addTime(applyStageLen + 1)

      // register
      await curation.registerUnchallengedApplication(entryId)

      return assertRevert(async () => {
        await curation.registerUnchallengedApplication(entryId)
      })
    })

    // ----------- Remove application by applicant --------------
    it('removes application', async () => {
      const entryId = await createApplication()

      const receipt = await curation.removeApplication(entryId, { from: applicant })
      // tokens have been unlocked
      assert.isTrue(checkUnlocked(receipt, applicant, curation.address, appLockId), "Applicant lock in Staking app should have been unlocked")
      // used lock has been removed
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      assert.isFalse(appUsedLock, "Applicant used lock should have been freed")
    })

    it('fails removing application with an ongoing challenge', async () => {
      const entryId = await applyAndChallenge()

      return assertRevert(async () => {
        await curation.removeApplication(entryId)
      })
    })

    it('fails removing application by non-applicant', async () => {
      const entryId = await createApplication()

      return assertRevert(async () => {
        await curation.removeApplication(entryId, { from: challenger })
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
    const voteId = 1
    beforeEach(async () => {
      registry = await getContract('RegistryApp').new()
      staking = await getContract('StakingMock').new()
      voting = await getContract('VotingMock').new()
      await voting.setVoteId(voteId)

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
      const entryId = 1
      const lockId = 1
      return assertRevert(async () => {
        await curation.challengeApplication(entryId, lockId)
      })
    })

    it('fails resolving a challenge', async () => {
      return assertRevert(async () => {
        const entryId = 1
        await curation.resolveChallenge(entryId)
      })
    })

    it('fails registering an application', async () => {
      return assertRevert(async () => {
        const entryId = 1
        await curation.registerUnchallengedApplication(entryId)
      })
    })

    it('fails claiming reward', async () => {
      return assertRevert(async () => {
        const entryId = 1
        await curation.claimReward(voteId)
      })
    })

    it('fails trying to remove entry', async () => {
      return assertRevert(async () => {
        const entryId = 1
        await curation.removeApplication(entryId)
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

  // just to call getTimestamp and be able to reach 100% coverage
  context('Without Mock', async () => {
    const appLockId = 1
    const data = "Test"

    beforeEach(async () => {
      registry = await getContract('RegistryApp').new()
      staking = await getContract('StakingMock').new()
      voting = await getContract('VotingMock').new()

      curation = await getContract('Curation').new()
      MAX_UINT64 = await curation.MAX_UINT64()
      await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)

    })

    it('creates new Application', async () => {
      // mock lock
      await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
      // create application
      const r = await curation.newApplication(data, appLockId, { from: applicant })
      const entryId = getEvent(r, "NewApplication", "entryId")
      const application = await curation.getApplication.call(entryId)
      assert.equal(application[0], applicant, "Applicant should match")
      //assert.equal(application[1], , "Date should match")
      assert.equal(application[2], false, "Registered bool should match")
      assert.equal(application[3], web3.toHex(data), "Data should match")
      assert.equal(application[4], minDeposit, "Amount should match")
      assert.equal(application[5], appLockId, "LockId should match")
    })
  })
})
