pragma solidity 0.4.24;

import "@aragon/apps-registry/contracts/RegistryApp.sol";
import "@aragon/os/contracts/factory/EVMScriptRegistryFactory.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";


// You might think this file is a bit odd, but let me explain.
// We only use these contracts in our tests, which
// means Truffle will not compile them for us, because it is
// from an external dependency.
//
// We are now left with three options:
// - Copy/paste these contracts
// - Run the tests with `truffle compile --all` on
// - Or trick Truffle by claiming we use it in a Solidity test
//
// You know which one I went for.

contract TestCuration {
  // ...
}
