import base64url from 'base64url'
import { formatProofForSnarkjsVerification } from '@unirep/circuits'

import { DEFAULT_ETH_PROVIDER } from './defaults'
import { reputationProofPrefix, reputationPublicSignalsPrefix } from './prefix'
import { UnirepSocialContract } from '../core/UnirepSocialContract'
import { defaultPostReputation } from '../config/socialMedia'
import { verifyReputationProof } from './verifyReputationProof'
import { ReputationProof } from '@unirep/contracts'

const configureSubparser = (subparsers: any) => {
    const parser = subparsers.add_parser(
        'publishPost',
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
        '-tx', '--text',
        {
            required: true,
            type: 'str',
            help: 'The text written in the post',
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

const publishPost = async (args: any) => {
    // Ethereum provider
    const ethProvider = args.eth_provider ? args.eth_provider : DEFAULT_ETH_PROVIDER

    // Unirep Social contract
    const unirepSocialContract = new UnirepSocialContract(args.contract, ethProvider)

    // Parse Inputs
    const decodedProof = base64url.decode(args.proof.slice(reputationProofPrefix.length))
    const decodedPublicSignals = base64url.decode(args.public_signals.slice(reputationPublicSignalsPrefix.length))
    const publicSignals = JSON.parse(decodedPublicSignals)
    const proof = JSON.parse(decodedProof)
    const reputationProof = new ReputationProof(publicSignals, formatProofForSnarkjsVerification(proof))
    const epoch = reputationProof.epoch
    const epochKey = reputationProof.epochKey
    const repNullifiersAmount = reputationProof.proveReputationAmount
    const minRep = reputationProof.minRep

    if(args.min_rep != null){
        console.log(`Prove minimum reputation: ${minRep}`)
    }

    if(repNullifiersAmount != defaultPostReputation) {
        console.error(`Error: wrong post amount, expect ${defaultPostReputation}`)
        return
    }

    // Verify reputation proof
    await verifyReputationProof(args)

    // Connect a signer
    await unirepSocialContract.unlock(args.eth_privkey)

    // Submit tx
    let tx
    try {
        tx = await unirepSocialContract.publishPost(reputationProof, args.text)
    } catch(error) {
        console.log('Transaction Error', error)
        return
    }

    console.log(`Epoch key of epoch ${epoch}: ${epochKey}`)
    if(tx != undefined){
        await tx.wait()
        const proofIndex = await unirepSocialContract.getReputationProofIndex(reputationProof)
        console.log('Transaction hash:', tx?.hash)
        console.log('Proof index:', proofIndex.toNumber())
    }
}

export {
    publishPost,
    configureSubparser,
}