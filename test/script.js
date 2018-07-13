const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const { checkMovedTokens } = require('./helpers.js')

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

  const appLockId = 1
  const challengeLockId = 2
  const voteId = 1
  const data = "Test"

  const createApplication = async () => {
    // mock lock
    await staking.setLock(minDeposit, TIME_UNIT_SECONDS, MAX_UINT64, curation.address, "")
    const r = await curation.newApplication(data, appLockId, { from: applicant })
    const entryId = getEvent(r, "NewApplication", "entryId")

    return entryId
  }

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

  const applyChallengeAndResolve = async (result) => {
    const entryId = await applyAndChallenge()
    // mock vote result
    await voting.setVoteClosed(voteId, true)
    await voting.setVoteResult(voteId, result, WINNING_STAKE, TOTAL_STAKE)
    // resolve
    const receipt = await curation.resolveChallenge(entryId)

    return { entryId: entryId, receipt: receipt }
  }

  const applyChallengeAndExecute = async(result) => {
    const entryId = await applyAndChallenge()
    // mock vote result
    await voting.setVoteClosed(voteId, true)
    await voting.setVoteResult(voteId, result, WINNING_STAKE, TOTAL_STAKE)
    // execute vote
    const receipt = await voting.execute(voteId)

    return { entryId: entryId, receipt: receipt }
  }

  context('Using voting script', async () => {
    let daoFact

    before(async () => {
      const kernelBase = await getContract('Kernel').new()
      const aclBase = await getContract('ACL').new()
      const regFact = await getContract('EVMScriptRegistryFactory').new()
      daoFact = await getContract('DAOFactory').new(kernelBase.address, aclBase.address, regFact.address)
    })

    beforeEach(async () => {
      registry = await getContract('RegistryApp').new()
      staking = await getContract('StakingMock').new()

      // DAO
      const r = await daoFact.newDAO(owner)
      const dao = getContract('Kernel').at(r.logs.filter(l => l.event == 'DeployDAO')[0].args.dao)
      const acl = getContract('ACL').at(await dao.acl())

      await acl.createPermission(owner, dao.address, await dao.APP_MANAGER_ROLE(), owner, { from: owner })

      // Voting
      const receiptVoting = await dao.newAppInstance('0x5678', (await getContract('VotingMock').new()).address, { from: owner })
      voting = getContract('VotingMock').at(receiptVoting.logs.filter(l => l.event == 'NewAppProxy')[0].args.proxy)

      // Curation
      const receipt = await dao.newAppInstance('0x1234', (await getContract('CurationMock').new()).address, { from: owner })
      curation = getContract('CurationMock').at(receipt.logs.filter(l => l.event == 'NewAppProxy')[0].args.proxy)
      MAX_UINT64 = await curation.MAX_UINT64()

      await curation.initialize(registry.address, staking.address, voting.address, minDeposit, applyStageLen, dispensationPct)
    })

    it('challenges application and executes, challenge rejected', async () => {
      const {entryId, receipt} = await applyChallengeAndExecute(false)
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

    it('challenges application and executes, challenge accepted', async () => {
      const {entryId, receipt} = await applyChallengeAndExecute(true)
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
      assert.isFalse(checkMovedTokens(receipt, challenger, applicant, 0))
      assert.isTrue(checkMovedTokens(receipt, applicant, challenger, amount))
      // used locks
      const appUsedLock = await curation.getUsedLock.call(applicant, appLockId)
      const challengeUsedLock = await curation.getUsedLock.call(challenger,challengeLockId)
      assert.isFalse(appUsedLock, "There should be no lock for application")
      assert.isFalse(challengeUsedLock, "There should be no lock for challenge")
    })
  })
})
