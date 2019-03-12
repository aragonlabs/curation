import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import BN from 'bn.js'
import { map } from 'rxjs/operators'
import { AppBar, AppView, Button, Main, observe } from '@aragon/ui'
import { networkContextType } from './lib/provideNetwork'

class App extends React.Component {
  static propTypes = {
    app: PropTypes.object.isRequired,
  }
  static defaultProps = {
    network: {},
    userAccount: '',
  }
  static childContextTypes = {
    network: networkContextType,
  }
  state = {
    NewSubmissionOpened: false,
  }

  getChildContext() {
    const { network } = this.props
    return {
      network: {
        type: network.type,
      },
    }
  }
  handleNewSubmissionOpen = () => {
    this.setState({ NewSubmissionOpened: true })
  }
  handleNewSubmissionClose = () => {
    this.setState({ NewSubmissionOpened: false })
  }

  // handleWithdraw = (tokenAddress, recipient, amount, reference) => {
  //   // Immediate, one-time payment
  //   this.props.app.newPayment(
  //     tokenAddress,
  //     recipient,
  //     amount,
  //     0, // initial payment time
  //     0, // interval
  //     1, // max repeats
  //     reference
  //   )
  //   this.handleNewSubmissionClose()
  // }

  render() {
    const { app, userAccount } = this.props
    // const { NewSubmissionOpened } = this.state

    return (
      <div css="min-width: 320px">
        <Main assetsUrl="./aragon-ui">
          <AppView
            appBar={
              <AppBar>
                <h1>Token Curated List</h1>
                <Button mode="strong" onClick={this.handleNewSubmissionOpen}>
                  New Submission
                </Button>
              </AppBar>
            }
          />
        </Main>
      </div>
    )
  }
}

export default observe(
  observable => observable.pipe(map(state => ({ ...state }))),
  {}
)(App)
