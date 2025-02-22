// @ts-ignore
import { ethers as hardhatEthers } from 'hardhat'
import { ethers } from 'ethers'
import { expect } from 'chai'
import { attestingFee, epochLength, epochTreeDepth, globalStateTreeDepth, numEpochKeyNoncePerEpoch, userStateTreeDepth, maxReputationBudget } from '@unirep/unirep'
import { deployUnirep } from '@unirep/contracts'
import { genIdentity, genIdentityCommitment } from '@unirep/crypto'

import { getTreeDepthsForTesting } from './utils'
import { defaultAirdroppedReputation, defaultCommentReputation, defaultPostReputation } from '../config/socialMedia'
import { deployUnirepSocial } from '../core/utils'


describe('Signup', function () {
    this.timeout(1000000)
    let unirepContract
    let unirepSocialContract
    
    let accounts: ethers.Signer[]
    const maxUsers = 3
    const maxAttesters = 3
    
    before(async () => {
        accounts = await hardhatEthers.getSigners()

        const _treeDepths = getTreeDepthsForTesting("contract")
        const _settings = {
            maxUsers: maxUsers,
            maxAttesters: maxAttesters,
            numEpochKeyNoncePerEpoch: numEpochKeyNoncePerEpoch,
            maxReputationBudget: maxReputationBudget,
            epochLength: epochLength,
            attestingFee: attestingFee
        }
        unirepContract = await deployUnirep(<ethers.Wallet>accounts[0], _treeDepths, _settings)
        unirepSocialContract = await deployUnirepSocial(<ethers.Wallet>accounts[0], unirepContract.address)
    })

    it('should have the correct config value', async () => {
        const attestingFee_ = await unirepContract.attestingFee()
        expect(attestingFee).equal(attestingFee_)
        const epochLength_ = await unirepContract.epochLength()
        expect(epochLength).equal(epochLength_)
        const numEpochKeyNoncePerEpoch_ = await unirepContract.numEpochKeyNoncePerEpoch()
        expect(numEpochKeyNoncePerEpoch).equal(numEpochKeyNoncePerEpoch_)
        const maxUsers_ = await unirepContract.maxUsers()
        expect(maxUsers).equal(maxUsers_)

        const treeDepths_ = await unirepContract.treeDepths()
        expect(epochTreeDepth).equal(treeDepths_.epochTreeDepth)
        expect(globalStateTreeDepth).equal(treeDepths_.globalStateTreeDepth)
        expect(userStateTreeDepth).equal(treeDepths_.userStateTreeDepth)

        const postReputation_ = await unirepSocialContract.postReputation()
        expect(postReputation_).equal(defaultPostReputation)
        const commentReputation_ = await unirepSocialContract.commentReputation()
        expect(commentReputation_).equal(defaultCommentReputation)
        const airdroppedReputation_ = await unirepSocialContract.airdroppedReputation()
        expect(airdroppedReputation_).equal(defaultAirdroppedReputation)
        const unirepAddress_ = await unirepSocialContract.unirep()
        expect(unirepAddress_).equal(unirepContract.address)
        const unirepSocialAttesterId = await unirepContract.attesters(unirepSocialContract.address)
        expect(unirepSocialAttesterId.toNumber()).equal(1)
    })

    describe('User sign-ups', () => {
        const id = genIdentity()
        const commitment = genIdentityCommitment(id)

        it('sign up should succeed', async () => {
            const tx = await unirepSocialContract.userSignUp(commitment)
            const receipt = await tx.wait()

            expect(receipt.status).equal(1)

            const numUserSignUps_ = await unirepContract.numUserSignUps()
            expect(1).equal(numUserSignUps_)
        })

        it('double sign up should fail', async () => {
            await expect(unirepSocialContract.userSignUp(commitment))
                .to.be.revertedWith('Unirep: the user has already signed up')
        })

        it('sign up should fail if max capacity reached', async () => {
            for (let i = 1; i < maxUsers; i++) {
                let tx = await unirepSocialContract.userSignUp(
                    genIdentityCommitment(genIdentity())
                )
                let receipt = await tx.wait()
                expect(receipt.status).equal(1)
            }
            await expect(unirepSocialContract.userSignUp(genIdentityCommitment(genIdentity())))
                .to.be.revertedWith('Unirep: maximum number of user signups reached')
        })
    })
})