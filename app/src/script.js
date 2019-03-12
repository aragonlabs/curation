import Aragon from '@aragon/api'
// import { first } from 'rxjs/operators'
import { of } from 'rxjs'
// import { addressesEqual } from './lib/web3-utils'

const INITIALIZATION_TRIGGER = Symbol('INITIALIZATION_TRIGGER')

// Starting point
start()

async function start() {
  const app = new Aragon()

  const contracts = await initDependencyContracts()

  initStore({ app, contracts })
}

async function initDependencyContracts(app) {
  const contracts = {} // 'CONTRACT_VARIABLE' -> External contract object
  // Get dep contracts of curation contract
  // {
  //   const address = await app.call('PCLR_CONTRACT_VARIABLE').toPromise()
  //   const contract = app.external(pclrAddress, pclrAbi)
  //   const initializationBlock = await contract.getInitializationBlock().toPromise()

  //   contracts.pclr = {
  //     contract,
  //     initializationBlock
  //   }
  // }

  return contracts
}

function initStore({ app, contracts }) {
  app.store(
    async (state, { address: eventAddress, event: eventName }) => {
      if (eventName === INITIALIZATION_TRIGGER) {
        return getInititalState()
      }

      switch (event.event) {
        default:
          return state
      }
    },
    [
      of({ event: INITIALIZATION_TRIGGER }),
      // Handle Vault events in case they're not always controlled by this Finance app
      // contracts.pclr.events(vaultInitializationBlock),
    ]
  )
}

async function getInititalState() {
  return {
    submissions: [
      {
        id:
          '0x50733298cf70be4d917005b60ef8eea9d8796bb39846e285b2258b59e995ba97',
        submitter: '0x3bD60bafEa8A7768C6f4352AF4Cfe01701884Ff2',
        date: '1552394451',
        registered: true,
        data: 'restraunt ipfs hash or ',
        stakedAmount: '100',
      },
    ],
  }
}

// // helpers
// function getValue() {
//   // Get current value from the contract by calling the public getter
//   return new Promise(resolve => {
//     app
//       .call('value')
//       .first()
//       .map(value => parseInt(value, 10))
//       .subscribe(resolve)
//   })
// }
