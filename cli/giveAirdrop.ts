import base64url from 'base64url'

import { DEFAULT_ETH_PROVIDER } from './defaults'
import { signUpProofPrefix, signUpPublicSignalsPrefix } from './prefix'
import { UnirepSocialContract } from '../core/UnirepSocialContract'
import { verifyAirdropProof } from './verifyAirdropProof'

const configureSubparser = (subparsers: any) => {
    const parser = subparsers.add_parser(
        'giveAirdrop',
        { add_help: true },
    )

    parser.add_argument(
        '-e', '--eth-provider',
        {
            action: 'store',
            type: 'str',
            help: `A connection string to an Ethereum provider. Default: ${DEFAULT_ETH_PROVIDER}`,
        }
    )

    parser.add_argument(
        '-p', '--public-signals',
        {
            required: true,
            type: 'str',
            help: 'The snark public signals of the user\'s epoch key ',
        }
    )

    parser.add_argument(
        '-pf', '--proof',
        {
            required: true,
            type: 'str',
            help: 'The snark proof of the user\'s epoch key ',
        }
    )

    parser.add_argument(
        '-b', '--start-block',
        {
            action: 'store',
            type: 'int',
            help: 'The block the Unirep contract is deployed. Default: 0',
        }
    )
    
    parser.add_argument(
        '-x', '--contract',
        {
            required: true,
            type: 'str',
            help: 'The Unirep Social contract address',
        }
    )

    parser.add_argument(
        '-d', '--eth-privkey',
        {
            required: true,
            action: 'store',
            type: 'str',
            help: 'The deployer\'s Ethereum private key',
        }
    )
}

const giveAirdrop = async (args: any) => {
    // Ethereum provider
    const ethProvider = args.eth_provider ? args.eth_provider : DEFAULT_ETH_PROVIDER

    // Unirep Social contract
    const unirepSocialContract = new UnirepSocialContract(args.contract, ethProvider)

    // Parse Inputs
    const decodedProof = base64url.decode(args.proof.slice(signUpProofPrefix.length))
    const decodedPublicSignals = base64url.decode(args.public_signals.slice(signUpPublicSignalsPrefix.length))
    const publicSignals = JSON.parse(decodedPublicSignals)
    const epoch = publicSignals[0]
    const epk = publicSignals[1]
    const GSTRoot = publicSignals[2]
    const attesterId = publicSignals[3]
    const userHasSignedUp = publicSignals[4]
    const proof = JSON.parse(decodedProof)

    // Verify reputation proof
    await verifyAirdropProof(args)

    // Connect a signer
    await unirepSocialContract.unlock(args.eth_privkey)

    let tx
    if(Number(userHasSignedUp)) {
        // if user has signed before, call the airdrop function
        tx = await unirepSocialContract.airdrop(publicSignals, proof)
    } else {
        // else, sign up the user 
        // tx = await unirepSocialContract.userSignUpWithProof(publicSignals, proof)
    }

    if(tx != undefined){
        console.log(`The user of epoch key ${epk} will get airdrop in the next epoch`)
        console.log('Transaction hash:', tx?.hash)
    }
}

export {
    giveAirdrop,
    configureSubparser,
}