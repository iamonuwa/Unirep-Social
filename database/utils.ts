import { BigNumber, ethers } from 'ethers'
import mongoose from 'mongoose'
import { genIdentityCommitment } from '@unirep/crypto'
import { getUnirepContract } from '@unirep/contracts'

import Settings, { ISettings } from './models/settings'
// import UserSignUp, { IUserSignUp } from './models/userSignUp'
import Attestations, { IAttestation } from './models/attestation'
import Post, { IPost } from "../database/models/post";
import Comment, { IComment } from "../database/models/comment";
// import ReputationNullifier, { IReputationNullifier } from "../database/models/reputationNullifier";
// import UserTransitionedState, { IUserTransitionedState } from "../database/models/userTransitionedState";
import GSTLeaves, { IGSTLeaf, IGSTLeaves } from '../database/models/GSTLeaf'
import EpochTreeLeaves, { IEpochTreeLeaf } from '../database/models/epochTreeLeaf'
import Nullifier, { INullifier } from '../database/models/nullifiers'

import { hash5, hashLeftRight, IncrementalQuinTree, stringifyBigInts } from 'maci-crypto'
import { computeEmptyUserStateRoot, defaultUserStateLeaf, genEpochKey, genEpochKeyNullifier, genNewSMT, SMT_ONE_LEAF, SMT_ZERO_LEAF } from '../test/utils'

import { assert } from 'console'
import Unirep from "../node_modules/@unirep/contracts/artifacts/contracts/Unirep.sol/Unirep.json"
import UnirepSocial from "../artifacts/contracts/UnirepSocial.sol/UnirepSocial.json"
import { add0x, SparseMerkleTreeImpl } from '@unirep/crypto'
import { defaultAirdroppedReputation, maxReputationBudget } from '../config/socialMedia'
import { dbUri } from '../config/database'
import { Reputation } from '@unirep/unirep'
import { DEFAULT_ETH_PROVIDER, } from '../cli/defaults'
import GSTRoots, { IGSTRoot } from './models/GSTRoots'

enum action {
    UpVote = 0,
    DownVote = 1,
    Post = 2,
    Comment = 3
}

export interface IUserTransitionState {
    transitionedGSTLeafIndex: number
    fromEpoch: number
    toEpoch: number
    userStateTree: SparseMerkleTreeImpl
    attestations: IAttestation[]
    transitionedPosRep: BigInt
    transitionedNegRep: BigInt
    GSTLeaf: string
}

/*
* Connect to db uri
* @param dbUri mongoose database uri
*/
const connectDB = async(dbUri: string): Promise<typeof mongoose> => {

    const db = await mongoose.connect(
        dbUri, 
         { useNewUrlParser: true, 
           useFindAndModify: false, 
           useUnifiedTopology: true
         }
     )
    
     return db
}

/*
* Initialize the database by dropping the existing database
* returns true if it is successfully deleted
* @param db mongoose type database object
*/
const initDB = async(db: typeof mongoose)=> {

    const deletedDb = await db.connection.db.dropDatabase()

    return deletedDb
}

/*
* Disconnect to db uri
* @param db mongoose type database object
*/
const disconnectDB = (db: typeof mongoose): void => {

    db.disconnect()

    return
}


const saveSettingsFromContract = async (unirepContract: ethers.Contract): Promise<ISettings> => {

    let settings
    const existedSettings = await Settings.findOne()
    if(existedSettings === null){

        const treeDepths_ = await unirepContract.treeDepths()
        const globalStateTreeDepth = treeDepths_.globalStateTreeDepth
        const userStateTreeDepth = treeDepths_.userStateTreeDepth
        const epochTreeDepth = treeDepths_.epochTreeDepth
        const nullifierTreeDepth = treeDepths_.nullifierTreeDepth
        const attestingFee = await unirepContract.attestingFee()
        const epochLength = await unirepContract.epochLength()
        const numEpochKeyNoncePerEpoch = await unirepContract.numEpochKeyNoncePerEpoch()
        const numAttestationsPerEpochKey = await unirepContract.numAttestationsPerEpochKey()    
        const emptyUserStateRoot = computeEmptyUserStateRoot(ethers.BigNumber.from(userStateTreeDepth).toNumber())
        settings = new Settings({
            globalStateTreeDepth: ethers.BigNumber.from(globalStateTreeDepth).toNumber(),
	        userStateTreeDepth: ethers.BigNumber.from(userStateTreeDepth).toNumber(),
	        epochTreeDepth: ethers.BigNumber.from(epochTreeDepth).toNumber(),
	        nullifierTreeDepth: ethers.BigNumber.from(nullifierTreeDepth).toNumber(),
	        attestingFee: attestingFee,
            epochLength: ethers.BigNumber.from(epochLength).toNumber(),
	        numEpochKeyNoncePerEpoch: ethers.BigNumber.from(numEpochKeyNoncePerEpoch).toNumber(),
	        numAttestationsPerEpochKey: ethers.BigNumber.from(numAttestationsPerEpochKey).toNumber(),
	        defaultGSTLeaf: hash5([
                BigInt(0),  // zero identityCommitment
                emptyUserStateRoot,  // zero user state root
                BigInt(0), // default airdropped karma
                BigInt(0), // default negative karma
                BigInt(0)
            ])
        })
    }

    return existedSettings? existedSettings : settings.save()
}

/*
* Computes the global state tree of given epoch
* @param epoch current epoch
*/
const genGSTreeFromDB = async (epoch: number): Promise<IncrementalQuinTree> => {
    
    const _settings = await Settings.findOne()
    const treeLeaves = await GSTLeaves?.findOne({epoch: epoch})
    if (!_settings) {
        throw new Error('Error: should save settings first')
    } 

    const globalStateTreeDepth = _settings.globalStateTreeDepth
    const defaultGSTLeaf = BigInt(_settings.defaultGSTLeaf)
    const GSTree = new IncrementalQuinTree(
        globalStateTreeDepth,
        defaultGSTLeaf,
        2,
    )

    const GSTLeavesToEpoch = treeLeaves?.get('GSTLeaves')
    let leaves: BigInt[] = []
    for (let i = 0; i < GSTLeavesToEpoch.length; i++) {
        leaves.push(BigInt(GSTLeavesToEpoch[i]?.hashedLeaf))
    }

    for(const leaf of leaves){
        GSTree.insert(leaf)
    }

    return GSTree
}

/*
* Computes the epoch tree of given epoch
* @param epoch current epoch
*/
// const genEpochTreeFromDB = async (epoch: number): Promise<SparseMerkleTreeImpl> => {
    
//     const _settings = await Settings.findOne()
//     const treeLeaves = await EpochTreeLeaves?.findOne({epoch: epoch})
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     }

//     const epochTreeDepth = _settings.epochTreeDepth
    
//     const epochTree = await genNewSMT(epochTreeDepth, SMT_ONE_LEAF)
//     const leaves = treeLeaves?.epochTreeLeaves? treeLeaves?.epochTreeLeaves : []
//     for (const leaf of leaves) {
//         const decEpochKey = BigInt(BigInt(add0x(leaf.epochKey)).toString())
//         await epochTree.update(decEpochKey, BigInt(leaf.hashchainResult))
//     }

//     return epochTree
// }

// /*
// * Computes the nullifier tree of given epoch
// */
// const genNullifierTreeFromDB = async (): Promise<SparseMerkleTreeImpl> => {

//     const _settings = await Settings.findOne()
//     const treeLeaves = await NullifierTreeLeaves?.find()
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const nullifierTree = await genNewSMT(_settings.nullifierTreeDepth, SMT_ZERO_LEAF)
//     await nullifierTree.update(BigInt(0), SMT_ONE_LEAF)

//     if (treeLeaves.length == 0) return nullifierTree
//     else{
//         for (const leaf of treeLeaves) {
//             await nullifierTree.update(BigInt(leaf.nullifier), SMT_ONE_LEAF)
//         }
//         return nullifierTree
//     }
// }

/*
* Get the attestations of given epoch key
* @param epochKey given epoch key
*/
const getAttestationsFromDB = async (epochKey: string): Promise<IAttestation[] > => {
    const attestationsToEpochKey = await Attestations.findOne({epochKey: epochKey})
    if ( attestationsToEpochKey ){
        return attestationsToEpochKey?.attestations
    }
    else {
        return []
    }
    
}

// /*
// * Get the nullifier of the attestations of given epoch
// * @param epoch given epoch
// * @param id user's identity
// */
// const getAttestationNullifiersFromDB = async (epoch: number, id: any): Promise<BigInt[]> => {

//     const _settings = await Settings.findOne()
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const epochTreeDepth = _settings.epochTreeDepth
//     const numEpochKeyNoncePerEpoch = _settings.numEpochKeyNoncePerEpoch
//     const numAttestationsPerEpochKey = _settings.numAttestationsPerEpochKey
//     const nullifiers: BigInt[] = []
//     for (let nonce = 0; nonce < numEpochKeyNoncePerEpoch; nonce++) {
//         const epochKey = genEpochKey(id.identityNullifier, epoch, nonce, epochTreeDepth)
//         const attestations = await getAttestationsFromDB(epochKey.toString(16))
//         if(!attestations) return nullifiers
//         for (const attestation of attestations) {
//             nullifiers.push(
//                 genAttestationNullifier(id.identityNullifier, BigInt(attestation.attesterId), epoch, epochKey, _settings.nullifierTreeDepth)
//                 )
//         }
//         for (let i = 0; i < (numAttestationsPerEpochKey - attestations.length); i++) {
//             nullifiers.push(BigInt(0))
//         }
//     }

//     return nullifiers
// }

/*
* Assert user has signed up and find the epoch where user signed up
* finding user's signed up leaf event in db
* @param id user's identity
*/
// const findUserSignedUpEpochFromDB = async (id: any): Promise<IUserSignUp | null> => {

//     const _settings = await Settings.findOne()
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const emptyUserStateRoot = computeEmptyUserStateRoot(_settings.userStateTreeDepth)
//     const userDefaultGSTLeaf = hash5([
//         genIdentityCommitment(id),
//         emptyUserStateRoot,
//         BigInt(defaultAirdroppedReputation),
//         BigInt(0),
//         BigInt(0)
//     ]).toString(16)
//     const result = await UserSignUp.findOne({hashedLeaf: add0x(userDefaultGSTLeaf)})
//     return result
// }

const nullifierExists = async (nullifier: string, epoch?: number): Promise<boolean> => {
    const n = await Nullifier.findOne({
        $or: [
            {epoch: epoch, nullifier: nullifier},
            {nullifier: nullifier},
        ]
    })
    if (n != undefined) return true
    return false
}


/*
* get GST leaf index of given epoch
* @param epoch find GST leaf in the epoch
* @param hasedLeaf find the hash of GST leaf
*/
const getGSTLeafIndex = async (epoch: number, hashedLeaf: string): Promise<number> => {

    const leaves = await GSTLeaves.findOne({epoch: epoch})
    if(leaves){
        for(const leaf of leaves.get('GSTLeaves')){
            if (leaf.hashedLeaf == hashedLeaf){
                return leaves?.GSTLeaves?.indexOf(leaf)
            }
        }
    }

    return -1
}

/*
* generate user state tree from given reputations
* @param reputations reputations received by user in current epoch
*/
// const genUserStateTreeFromDB = async(
//     reputations: IAttestation[]
// ): Promise<SparseMerkleTreeImpl> => {

//     const settings = await Settings.findOne()
//     if (!settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     let reputationRecords = {}
//     const USTree = await genNewSMT(settings.userStateTreeDepth, defaultUserStateLeaf)

//     for (const reputation of reputations) {
//         if (reputationRecords[reputation.attesterId] === undefined) {
//             reputationRecords[reputation.attesterId] = new Reputation(
//                 BigInt(reputation.posRep),
//                 BigInt(reputation.negRep),
//                 BigInt(reputation.graffiti)
//             )
//         } else {
//             // Update attestation record
//             reputationRecords[reputation.attesterId].update(
//                 BigInt(reputation.posRep),
//                 BigInt(reputation.negRep),
//                 BigInt(reputation.graffiti),
//                 reputation.overwriteGraffiti
//             )
//         }
//     }

//     for (let attesterId in reputationRecords) {
//         const hashedReputation = hash5([
//             BigInt(reputationRecords[attesterId].posRep),
//             BigInt(reputationRecords[attesterId].negRep),
//             BigInt(reputationRecords[attesterId].graffiti),
//             BigInt(0),
//             BigInt(0)
//         ])
//         await USTree.update(BigInt(attesterId), hashedReputation)
//     }

//     return USTree
// }

// const getRepByAttester = async (
//     reputations: IAttestation[],
//     attesterId: string,
// ) => {
//     const leaf = reputations.find((leaf) => BigInt(leaf.attesterId) == BigInt(attesterId))
//     if(leaf !== undefined) return leaf
//     else {
//         const defaultAttestation: IAttestation = {
//             transactionHash: "0",
//             epoch: 0,
//             attester: "0",
//             attesterId: "0",
//             posRep: "0",
//             negRep: "0",
//             graffiti: "0",
//             overwriteGraffiti: false
//         }
//         return defaultAttestation
//     }
// }


/*
* Retrives the updated UserState from the database
* @param currentEpoch current epoch
* @param userIdentity user's semaphore identity
*/
// const genCurrentUserStateFromDB = async ( 
//     currentEpoch: number,
//     id: any,
//  ) => {
//     const settings = await Settings.findOne()
//     if (!settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const idCommitment = genIdentityCommitment(id)
//     const epochTreeDepth = settings.epochTreeDepth
//     const numEpochKeyNoncePerEpoch = settings.numEpochKeyNoncePerEpoch

//     const userHasSignedUp = await findUserSignedUpEpochFromDB(id)
//     assert(userHasSignedUp, "User has not signed up yet")
//     if(!userHasSignedUp){
//         return
//     }

//     // start user state
//     let transitionedFromEpoch = userHasSignedUp?.epoch ? userHasSignedUp?.epoch : 0
//     let startEpoch = transitionedFromEpoch
//     let transitionedPosRep = defaultAirdroppedReputation
//     let transitionedNegRep = 0
//     let userStates: {[key: number]: IUserTransitionState} = {}
//     let GSTLeaf = userHasSignedUp?.hashedLeaf
//     let userStateTree: SparseMerkleTreeImpl = await genUserStateTreeFromDB([])
//     let attestations: IAttestation[] = []
//     let transitionedGSTLeaf = await getGSTLeafIndex(startEpoch, GSTLeaf)
   
//     // find all reputation received by the user
//     for (let e = startEpoch; e <= currentEpoch; e++) {

//         // find if user has transitioned 
//         if (e !== startEpoch) {
//             transitionedGSTLeaf = await getGSTLeafIndex(e, GSTLeaf)
//         }
        
//         // user transitioned state
//         const newState: IUserTransitionState = {
//             transitionedGSTLeafIndex: transitionedGSTLeaf,
//             fromEpoch: transitionedFromEpoch,
//             toEpoch: e,
//             userStateTree: userStateTree,
//             attestations: attestations,
//             transitionedPosRep: BigInt(transitionedPosRep),
//             transitionedNegRep: BigInt(transitionedNegRep),
//             GSTLeaf: GSTLeaf
//         }
//         userStates[e] = newState

//         // get all attestations from epoch key generated in the given epoch e
//         attestations = []
//         for (let nonce = 0; nonce < numEpochKeyNoncePerEpoch; nonce++) {
//             const epochKey = genEpochKey(id.identityNullifier, e, nonce, epochTreeDepth)
//             const attestationToEpk = await Attestations.findOne({epochKey: epochKey.toString(16)})
//             attestationToEpk?.attestations?.map((a) => {attestations.push(a)})
//         }
//         userStateTree = await genUserStateTreeFromDB(attestations)

//         // compute user state transition result
//         transitionedFromEpoch = e
//         for (const attestation of attestations) {
//             transitionedPosRep += Number(attestation.posRep)
//             transitionedNegRep += Number(attestation.negRep)
//         }
//         transitionedPosRep += defaultAirdroppedReputation
//         GSTLeaf = add0x(hash5([
//             idCommitment,
//             userStateTree.getRootHash(),
//             BigInt(transitionedPosRep),
//             BigInt(transitionedNegRep),
//             BigInt(0)
//         ]).toString(16))
//     }

//     return userStates
   
// }

// const genProveReputationCircuitInputsFromDB = async (
//     epoch: number,
//     id: any,
//     epochKeyNonce: number,
//     proveKarmaAmount: number,
//     minRep: number,
// ) => {
//     const db = await mongoose.connect(
//         dbUri, 
//          { useNewUrlParser: true, 
//            useFindAndModify: false, 
//            useUnifiedTopology: true
//          }
//     )
//     const settings = await Settings.findOne()
//     if (!settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const epochTreeDepth = settings.epochTreeDepth
//     const nullifierTreeDepth = settings.nullifierTreeDepth

//     const userState = await genCurrentUserStateFromDB(epoch, id)
//     if(!userState) return
//     const epochKey = genEpochKey(id.identityNullifier, epoch, epochKeyNonce, epochTreeDepth)
//     const nonce = 0
//     const userStateTree = await userState[epoch].userStateTree
//     const GSTree = await genGSTreeFromDB(epoch)
//     const GSTLeafIndex = await getGSTLeafIndex(epoch, userState[epoch].GSTLeaf)
//     const GSTreeProof = GSTree.genMerklePath(GSTLeafIndex)
//     const GSTreeRoot = GSTree.root
//     const nullifierTree = await genNullifierTreeFromDB()
//     const nullifierTreeRoot = nullifierTree.getRootHash()
//     const epkNullifier = genEpochKeyNullifier(id.identityNullifier, epoch, nonce)
//     const epkNullifierProof = await nullifierTree.getMerkleProof(epkNullifier)
//     const hashedLeaf = hash5([
//         genIdentityCommitment(id),
//         userStateTree.getRootHash(),
//         userState[epoch].transitionedPosRep,
//         userState[epoch].transitionedNegRep,
//         BigInt(0)
//     ])
//     let nonceStarter = -1
//     const repDiff: number = Number(userState[epoch].transitionedPosRep) - Number(userState[epoch].transitionedNegRep)

//     // find valid nonce starter
//     for (let n = 0; n < repDiff ; n++) {
//         const karmaNullifier = (id.identityNullifier, epoch, n)
//         const res = await ReputationNullifier?.findOne({nullifiers: karmaNullifier.toString()})
//         if(!res) {
//             nonceStarter = n
//             break
//         }
//     }
//     assert(nonceStarter != -1, "Cannot find valid nonce")
//     assert((nonceStarter + proveKarmaAmount) <= repDiff, "Not enough karma to spend")
//     const selectors: BigInt[] = []
//     const nonceList: BigInt[] = []
//     for (let i = 0; i < proveKarmaAmount; i++) {
//         nonceList.push( BigInt(nonceStarter + i) )
//         selectors.push(BigInt(1));
//     }
//     for (let i = proveKarmaAmount ; i < maxReputationBudget; i++) {
//         nonceList.push(BigInt(0))
//         selectors.push(BigInt(0))
//     }

//     db.disconnect();

//     return stringifyBigInts({
//         epoch: epoch,
//         nonce: nonce,
//         identity_pk: id.keypair.pubKey,
//         identity_nullifier: id.identityNullifier, 
//         identity_trapdoor: id.identityTrapdoor,
//         user_tree_root: userStateTree.getRootHash(),
//         user_state_hash: hashedLeaf,
//         epoch_key_nonce: epochKeyNonce,
//         epoch_key: epochKey,
//         GST_path_index: GSTreeProof.indices,
//         GST_path_elements: GSTreeProof.pathElements,
//         GST_root: GSTreeRoot,
//         nullifier_tree_root: nullifierTreeRoot,
//         nullifier_path_elements: epkNullifierProof,
//         selectors: selectors,
//         positive_karma: userState[epoch].transitionedPosRep,
//         negative_karma: userState[epoch].transitionedNegRep,
//         prove_karma_nullifiers: BigInt(Boolean(proveKarmaAmount)),
//         prove_karma_amount: BigInt(proveKarmaAmount),
//         karma_nonce: nonceList,
//         prove_min_rep: BigInt(Boolean(minRep)),
//         min_rep: BigInt(minRep)
//     })
// }

// const genProveReputationFromAttesterCircuitInputsFromDB = async (
//     epoch: number,
//     id: any,
//     attesterId: BigInt,
//     provePosRep: BigInt,
//     proveNegRep: BigInt,
//     proveRepDiff: BigInt,
//     proveGraffiti: BigInt,
//     minPosRep: BigInt,
//     maxNegRep: BigInt,
//     minRepDiff: BigInt,
//     graffitiPreImage: BigInt,
// ) => {
//     const db = await mongoose.connect(
//         dbUri, 
//          { useNewUrlParser: true, 
//            useFindAndModify: false, 
//            useUnifiedTopology: true
//          }
//     )
//     const settings = await Settings.findOne()
//     if (!settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const nullifierTreeDepth = settings.nullifierTreeDepth
//     const userStateTreeDepth = settings.userStateTreeDepth

//     const userState = await genCurrentUserStateFromDB(epoch, id)
//     if(!userState) return
//     assert(attesterId > BigInt(0), `attesterId must be greater than zero`)
//     assert(attesterId < BigInt(2 ** userStateTreeDepth), `attesterId exceeds total number of attesters`)

//     const latestGSTLeafIndex = userState[epoch].transitionedGSTLeafIndex
//     assert(latestGSTLeafIndex >= 0, `user haven't transitioned from ${userState[epoch].fromEpoch} epoch`)

//     const transitionedPosRep = userState[epoch].transitionedPosRep
//     const transitionedNegRep = userState[epoch].transitionedNegRep
//     const nonce = 0
//     const rep = await getRepByAttester(userState[epoch].attestations, attesterId.toString())
//     const posRep = rep.posRep
//     const negRep = rep.negRep
//     const graffiti = rep.graffiti
//     const userStateTree = await genUserStateTreeFromDB(userState[epoch].attestations)
//     const hashedLeaf = hash5([
//         genIdentityCommitment(id),
//         userStateTree.getRootHash(),
//         transitionedPosRep,
//         transitionedNegRep,
//         BigInt(0)
//     ])
//     const GSTree = await genGSTreeFromDB(epoch)
//     const GSTreeProof = GSTree.genMerklePath(latestGSTLeafIndex)
//     const GSTreeRoot = GSTree.root
//     const nullifierTree = await genNullifierTreeFromDB()
//     const nullifierTreeRoot = nullifierTree.getRootHash()
//     const epkNullifier = genEpochKeyNullifier(id.identityNullifier, epoch, nonce)
//     const epkNullifierProof = await nullifierTree.getMerkleProof(epkNullifier)
//     const USTPathElements = await userStateTree.getMerkleProof(attesterId)

//     db.disconnect();

//     return stringifyBigInts({
//         epoch: epoch,
//         nonce: nonce,
//         identity_pk: id.keypair.pubKey,
//         identity_nullifier: id.identityNullifier, 
//         identity_trapdoor: id.identityTrapdoor,
//         user_tree_root: userStateTree.getRootHash(),
//         user_state_hash: hashedLeaf,
//         GST_path_index: GSTreeProof.indices,
//         GST_path_elements: GSTreeProof.pathElements,
//         GST_root: GSTreeRoot,
//         nullifier_tree_root: nullifierTreeRoot,
//         nullifier_path_elements: epkNullifierProof,
//         attester_id: attesterId,
//         pos_rep: posRep,
//         neg_rep: negRep,
//         graffiti: graffiti,
//         UST_path_elements: USTPathElements,
//         positive_karma: transitionedPosRep,
//         negative_karma: transitionedNegRep,
//         prove_pos_rep: provePosRep,
//         prove_neg_rep: proveNegRep,
//         prove_rep_diff: proveRepDiff,
//         prove_graffiti: proveGraffiti,
//         min_rep_diff: minRepDiff,
//         min_pos_rep: minPosRep,
//         max_neg_rep: maxNegRep,
//         graffiti_pre_image: graffitiPreImage
//     })

// }

// const genUserStateTransitionCircuitInputsFromDB = async (
//     epoch: number,
//     id: any,
// ) => {
//     const db = await mongoose.connect(
//         dbUri, 
//          { useNewUrlParser: true, 
//            useFindAndModify: false, 
//            useUnifiedTopology: true
//          }
//     )
//     const settings = await Settings.findOne()
//     if (!settings) {
//         throw new Error('Error: should save settings first')
//     } 

//     const epochTreeDepth = settings.epochTreeDepth
//     const numEpochKeyNoncePerEpoch = settings.numEpochKeyNoncePerEpoch
//     const numAttestationsPerEpochKey = settings.numAttestationsPerEpochKey
//     const DefaultHashchainResult = SMT_ONE_LEAF

//     const userState = await genCurrentUserStateFromDB(epoch, id)
//     if(!userState) return

//     const fromEpoch = userState[epoch].fromEpoch
//     const fromEpochUserStateTree: SparseMerkleTreeImpl = userState[fromEpoch].userStateTree
//     const intermediateUserStateTreeRoots: BigInt[] = [
//         fromEpochUserStateTree.getRootHash()
//     ]
    
//     // GSTree
//     const userStateLeafPathElements: any[] = []
//     const fromEpochGSTree: IncrementalQuinTree = await genGSTreeFromDB(fromEpoch)
//     const latestGSTLeafIndex = userState[fromEpoch].transitionedGSTLeafIndex
//     const GSTreeProof = fromEpochGSTree.genMerklePath(latestGSTLeafIndex)
//     const GSTreeRoot = fromEpochGSTree.root

//     //EpochTree
//     const fromEpochTree = await genEpochTreeFromDB(fromEpoch)
//     const epochTreeRoot = fromEpochTree.getRootHash()
//     const epochKeyPathElements: any[] = []
//     const hashChainResults: BigInt[] = []

//     // User state tree
//     const userStateTreeRoot = userState[fromEpoch].userStateTree.getRootHash()
//     const transitionedPosRep = userState[fromEpoch].transitionedPosRep
//     const transitionedNegRep = userState[fromEpoch].transitionedNegRep

//     const hashedLeaf = hash5([
//         genIdentityCommitment(id),
//         userStateTreeRoot,
//         transitionedPosRep,
//         transitionedNegRep,
//         BigInt(0)
//     ])

//     let reputationRecords = {}
//     const selectors: number[] = []
//     const attesterIds: BigInt[] = []
//     const oldPosReps: BigInt[] = [], oldNegReps: BigInt[] = [], oldGraffities: BigInt[] = []
//     const posReps: BigInt[] = [], negReps: BigInt[] = [], graffities: BigInt[] = [], overwriteGraffitis: any[] = []
//     let newPosRep = Number(userState[fromEpoch].transitionedPosRep) + defaultAirdroppedReputation
//     let newNegRep = Number(userState[fromEpoch].transitionedNegRep)

//     for (let nonce = 0; nonce < numEpochKeyNoncePerEpoch; nonce++) {
//         const epochKey = genEpochKey(id.identityNullifier, fromEpoch, nonce, epochTreeDepth)
        
//         // Attestations
//         const attestations = await getAttestationsFromDB(epochKey.toString(16))
//         for (let i = 0; i < attestations?.length; i++) {
//             const attestation = attestations[i]
//             const attesterId = attestation.attesterId
//             const oldAttestations = userState[fromEpoch].attestations
//             const rep = await getRepByAttester(oldAttestations, attesterId)

//             if (reputationRecords[attesterId.toString()] === undefined) {
//                 reputationRecords[attesterId.toString()] = new Reputation(
//                     BigInt(rep.posRep),
//                     BigInt(rep.negRep),
//                     BigInt(rep.graffiti)
//                 )
//             }

//             oldPosReps.push(reputationRecords[attesterId.toString()]['posRep'])
//             oldNegReps.push(reputationRecords[attesterId.toString()]['negRep'])
//             oldGraffities.push(reputationRecords[attesterId.toString()]['graffiti'])

//             // Add UST merkle proof to the list
//             const USTLeafPathElements = await fromEpochUserStateTree.getMerkleProof(BigInt(attesterId))
//             userStateLeafPathElements.push(USTLeafPathElements)

//             // Update attestation record
//             reputationRecords[attesterId.toString()].update(
//                 attestation['posRep'],
//                 attestation['negRep'],
//                 attestation['graffiti'],
//                 attestation['overwriteGraffiti']
//             )
//             // Update UST
//             await fromEpochUserStateTree.update(BigInt(attesterId), reputationRecords[attesterId.toString()].hash())
//             // Add new UST root to intermediate UST roots
//             intermediateUserStateTreeRoots.push(fromEpochUserStateTree.getRootHash())

//             selectors.push(1)
//             attesterIds.push(BigInt(attesterId))
//             posReps.push(BigInt(attestation.posRep))
//             negReps.push(BigInt(attestation.negRep))
//             graffities.push(BigInt(attestation.graffiti))
//             overwriteGraffitis.push(attestation.overwriteGraffiti)
//             newPosRep += Number(attestation.posRep)
//             newNegRep += Number(attestation.negRep)
//         }
//         // Fill in blank data for non-exist attestation
//         for (let i = 0; i < (numAttestationsPerEpochKey - attestations?.length); i++) {
//             oldPosReps.push(BigInt(0))
//             oldNegReps.push(BigInt(0))
//             oldGraffities.push(BigInt(0))
                
//             const USTLeafZeroPathElements = await fromEpochUserStateTree.getMerkleProof(BigInt(0))
//             userStateLeafPathElements.push(USTLeafZeroPathElements)
//             intermediateUserStateTreeRoots.push(fromEpochUserStateTree.getRootHash())

//             selectors.push(0)
//             attesterIds.push(BigInt(0))
//             posReps.push(BigInt(0))
//             negReps.push(BigInt(0))
//             graffities.push(BigInt(0))
//             overwriteGraffitis.push(false)
//         }
//         epochKeyPathElements.push(await fromEpochTree.getMerkleProof(epochKey))
//         const epochTreeLeaves = await EpochTreeLeaves.findOne({epoch: fromEpoch})
//         let hashChainResult = DefaultHashchainResult
//         if(epochTreeLeaves){
//             for (const leaf of epochTreeLeaves?.epochTreeLeaves) {
//                 if ( leaf.epochKey == epochKey.toString(16)){
//                     hashChainResult = BigInt(leaf.hashchainResult)
//                 }
//             }
//         }
//         hashChainResults.push(hashChainResult) 
//     }

//     db.disconnect();
    
//     return stringifyBigInts({
//         epoch: fromEpoch,
//         intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
//         old_pos_reps: oldPosReps,
//         old_neg_reps: oldNegReps,
//         old_graffities: oldGraffities,
//         UST_path_elements: userStateLeafPathElements,
//         identity_pk: id.keypair.pubKey,
//         identity_nullifier: id.identityNullifier,
//         identity_trapdoor: id.identityTrapdoor,
//         user_state_hash: hashedLeaf,
//         old_positive_karma: transitionedPosRep,
//         old_negative_karma: transitionedNegRep,
//         GST_path_elements: GSTreeProof.pathElements,
//         GST_path_index: GSTreeProof.indices,
//         GST_root: GSTreeRoot,
//         selectors: selectors,
//         attester_ids: attesterIds,
//         pos_reps: posReps,
//         neg_reps: negReps,
//         graffities: graffities,
//         overwrite_graffitis: overwriteGraffitis,
//         positive_karma: BigInt(newPosRep),
//         negative_karma: BigInt(newNegRep),
//         airdropped_karma: defaultAirdroppedReputation,
//         epk_path_elements: epochKeyPathElements,
//         hash_chain_results: hashChainResults,
//         epoch_tree_root: epochTreeRoot
//     })
// }

const getGSTLeaves = async (epoch: number): Promise<IGSTLeaf[]> => {
    const leaves = await GSTLeaves.findOne({epoch: epoch})
    return leaves? leaves.GSTLeaves : []
}

const getEpochTreeLeaves = async (epoch: number): Promise<IEpochTreeLeaf[]> => {
    const leaves = await EpochTreeLeaves.findOne({epoch: epoch})
    return leaves? leaves.epochTreeLeaves : []
}

const GSTRootExists = async (epoch: number, GSTRoot: string | BigInt): Promise<boolean> => {
    const root = await GSTRoots.findOne({epoch: epoch, GSTRoot: GSTRoot.toString()})
    if(root != undefined) return true
    return false
}

const epochTreeRootExists = async (epoch: number, epochTreeRoot: string | BigInt): Promise<boolean> => {
    const root = await EpochTreeLeaves.findOne({epoch: epoch, epochTreeRoot: epochTreeRoot.toString()})
    if(root != undefined) return true
    return false
}

const updateGSTLeaves = async (
    unirepAddress: string,
    provider: ethers.providers.Provider,
    _epoch: number,
    _GSTLeaves: string[],
    _GSTRoots: string[],
) => {
    const unirepContract = getUnirepContract(unirepAddress, provider)
    const newGSTLeafInsertedFilter = unirepContract.filters.NewGSTLeafInserted(_epoch)
    const newGSTLeafInsertedEvents =  await unirepContract.queryFilter(newGSTLeafInsertedFilter)

    let currentLeafIdx = 0
    const leaves: IGSTLeaf[] = []
    
    for (let i = 0; i < newGSTLeafInsertedEvents.length; i++) {
        const event = newGSTLeafInsertedEvents[i];
        const iface = new ethers.utils.Interface(Unirep.abi)
        const decodedData = iface.decodeEventLog("NewGSTLeafInserted",event.data)

        const _transactionHash = event.transactionHash
        const _hashedLeaf = add0x(decodedData?._hashedLeaf._hex)

        if(BigInt(_hashedLeaf) != BigInt(_GSTLeaves[currentLeafIdx])) continue

        // save the new leaf
        const newLeaf: IGSTLeaf = {
            transactionHash: _transactionHash,
            hashedLeaf: _GSTLeaves[currentLeafIdx]
        }
        leaves.push(newLeaf)
        
        // save the root
        const newRoot: IGSTRoot = new GSTRoots({
            epoch: _epoch,
            GSTRoot: _GSTRoots[currentLeafIdx],
            currentLeafIdx: currentLeafIdx,
        })
        await newRoot.save()
        currentLeafIdx ++ 
    }

    const treeLeaves: IGSTLeaves = new GSTLeaves({
        epoch: _epoch,
        GSTLeaves: leaves,
    })
    await treeLeaves.save()
}

const updateEpochTreeLeaves = async (
    epoch: number,
    epochTreeLeaves: IEpochTreeLeaf[],
    epochTreeRoot: string,
) => {
    const newEpochTreeLeaves = new EpochTreeLeaves({
        epoch: epoch,
        epochTreeLeaves: epochTreeLeaves,
        epochTreeRoot: epochTreeRoot,
    })

    await newEpochTreeLeaves.save()
}

const saveNullifier = async (_epoch: number, _nullifier: string) => {
    const nullifier: INullifier = new Nullifier({
        epoch: _epoch,
        nullifier: _nullifier
    })
    await nullifier.save()
}

/*
* When a newGSTLeafInserted event comes
* update the database
* @param event newGSTLeafInserted event
*/

const updateDBFromNewGSTLeafInsertedEvent = async (
    event: ethers.Event,
    startBlock: number  = DEFAULT_START_BLOCK,
) => {

    // The event has been processed
    if(event.blockNumber <= startBlock) return

    const iface = new ethers.utils.Interface(Unirep.abi)
    const decodedData = iface.decodeEventLog("NewGSTLeafInserted",event.data)

    const _transactionHash = event.transactionHash
    const _epoch = Number(event?.topics[1])
    const _hashedLeaf = add0x(decodedData?._hashedLeaf._hex)

    // save the new leaf
    const newLeaf: IGSTLeaf = {
        transactionHash: _transactionHash,
        hashedLeaf: _hashedLeaf
    }
    
    let treeLeaves: IGSTLeaves | null = await GSTLeaves.findOne({epoch: _epoch})

    if(!treeLeaves){
        treeLeaves = new GSTLeaves({
            epoch: _epoch,
            GSTLeaves: [newLeaf],
        })
    } else {
        treeLeaves.get('GSTLeaves').push(newLeaf)
    }

    const savedTreeLeavesRes = await treeLeaves?.save()

    if( savedTreeLeavesRes ){
        console.log('Database: saved new GST event')
    }
}

/*
* When an AttestationSubmitted event comes
* update the database
* @param event AttestationSubmitted event
*/
const updateDBFromAttestationEvent = async (
    event: ethers.Event,
    startBlock: number  = DEFAULT_START_BLOCK,
) => {

    // The event has been processed
    if(event.blockNumber <= startBlock) return

    const iface = new ethers.utils.Interface(Unirep.abi)
    const _epoch = event.topics[1]
    const _epochKey = BigInt(event.topics[2]).toString(16)
    const _attester = event.topics[3]
    const decodedData = iface.decodeEventLog("AttestationSubmitted",event.data)
    
    const newAttestation: IAttestation = {
        transactionHash: event.transactionHash,
        epoch: Number(_epoch),
        attester: _attester,
        attesterId: decodedData?.attestation?.attesterId?._hex,
        posRep: decodedData?.attestation?.posRep?._hex,
        negRep: decodedData?.attestation?.negRep?._hex,
        graffiti: decodedData?.attestation?.graffiti?._hex,
        overwriteGraffiti: decodedData?.attestation?.overwriteGraffiti,
    }

    let attestations = await Attestations.findOne({epochKey: _epochKey})

    if(!attestations){
        attestations = new Attestations({
            epochKey: _epochKey,
            attestations: [newAttestation]
        })
    } else {
        attestations.get('attestations').push(newAttestation)
    }
    
    const res = await attestations?.save()
    if(res){
        console.log('Database: saved submitted attestation')
    }
}

/*
* When a PostSubmitted event comes
* update the database
* @param event PostSubmitted event
*/
const updateDBFromPostSubmittedEvent = async (
    event: ethers.Event,
    startBlock: number  = DEFAULT_START_BLOCK,
) => {

    // The event has been processed
    if(event.blockNumber <= startBlock) return

    const postId = mongoose.Types.ObjectId(event.topics[2].slice(-24))
    const findPost = await Post.findById(postId)
    
    if(findPost){
        findPost?.set('status', 1, { "new": true, "upsert": false})
        findPost?.set('transactionHash', event.transactionHash, { "new": true, "upsert": false})
        await findPost?.save()
        console.log(`Database: updated ${postId} post`)
    } else {

        const iface = new ethers.utils.Interface(UnirepSocial.abi)
        const decodedData = iface.decodeEventLog("PostSubmitted",event.data)

        const newpost: IPost = new Post({
            _id: mongoose.Types.ObjectId(event.topics[2].slice(-24)),
            transactionHash: event.transactionHash,
            content: decodedData?._hahsedContent,
            // TODO: hashedContent
            epochKey: BigInt(event.topics[3]).toString(16),
            epkProof: decodedData?.proofRelated.proof.map((n)=> (n._hex)),
            minRep: Number(decodedData?.proofRelated.minRep._hex),
            comments: [],
            status: 1
        });

        await newpost.save()
        console.log(`Database: updated ${postId} post`)
    }
}

/*
* When a CommentSubmitted event comes
* update the database
* @param event CommentSubmitted event
*/
const updateDBFromCommentSubmittedEvent = async (
    event: ethers.Event,
    startBlock: number  = DEFAULT_START_BLOCK,
) => {

    // The event has been processed
    if(event.blockNumber <= startBlock) return

    const iface = new ethers.utils.Interface(UnirepSocial.abi)
    const decodedData = iface.decodeEventLog("CommentSubmitted",event.data)
    const commentId = mongoose.Types.ObjectId(decodedData?._commentId._hex.slice(-24))
    const findComment = await Comment.findById(commentId)
  
    const findPostByComment = await Post.findOne({ "comments._id": commentId })
    
    if(findComment) {
        findComment?.set('status', 1, { "new": true, "upsert": false})
        findComment?.set('transactionHash', event.transactionHash, { "new": true, "upsert": false})
        await findComment?.save()
    } else {
        const newComment: IComment = new Comment({
            _id: mongoose.Types.ObjectId(decodedData?._commentId._hex.slice(-24)),
            postId: BigInt(event.topics[2]).toString(16),
            transactionHash: event.transactionHash,
            content: decodedData?._hahsedContent,
            // TODO: hashedContent
            epoch: BigInt(event.topics[1]).toString(16),
            epochKey: BigInt(event.topics[3]).toString(16),
            epkProof: decodedData?.proofRelated.proof.map((n)=> (n._hex)),
            minRep: Number(decodedData?.proofRelated.minRep._hex),
            status: 1
        });

        await newComment.save()
    }

    if(findPostByComment) {

        await Post.findOneAndUpdate(
            { "comments._id": commentId },
            {$set: {
              "comments.$.status": 1,
              "comments.$.transactionHash": event.transactionHash
            }},
            { "new": true, "upsert": true }, 
    )
        console.log(`Database: updated ${commentId} comment`)

    } else {

        const newComment: IComment = new Comment({
            _id: mongoose.Types.ObjectId(decodedData?._commentId._hex.slice(-24)),
            transactionHash: event.transactionHash,
            content: decodedData?._hahsedContent,
            // TODO: hashedContent
            epochKey: BigInt(event.topics[3]).toString(16),
            epkProof: decodedData?.proofRelated.proof.map((n)=> (n._hex)),
            minRep: Number(decodedData?.proofRelated.minRep._hex),
            status: 1
        });

        await Post.findByIdAndUpdate(
            {_id: mongoose.Types.ObjectId(event.topics[2].slice(-24)) }, 
            { $push: {comments: newComment },},
            { "new": true, "upsert": true }
        )
        console.log(`Database: updated ${commentId} comment`)
    }
}

/*
* When a ReputationNullifierSubmitted event comes
* update the database
* @param event ReputationNullifierSubmitted event
*/
// const updateDBFromReputationNullifierSubmittedEvent = async (
//     event: ethers.Event,
//     startBlock: number  = DEFAULT_START_BLOCK,
// ) => {

//     // The event has been processed
//     if(event.blockNumber <= startBlock) return

//     const _settings = await Settings.findOne()
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     } 
//     const iface = new ethers.utils.Interface(Unirep.abi)
//     const decodedData = iface.decodeEventLog("ReputationNullifierSubmitted",event.data)
//     const default_nullifier = hash5([BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)])

//     for (let nullifier of decodedData.reputationNullifiers) {
//         if ( BigInt(nullifier) != default_nullifier ){
//             const modedNullifier = BigInt(nullifier) % BigInt(2 ** _settings.nullifierTreeDepth)
//             const newReputationNullifier: IReputationNullifier = new ReputationNullifier({
//                 transactionHash: event.transactionHash,
//                 action: action[decodedData.actionChoice],
//                 nullifiers: modedNullifier.toString()
//             })
    
//             const res = await newReputationNullifier.save()
//             if(res) {
//                 console.log('Database: saved reputation nullifiers')
//             }
//         }
//     }
// }

/*
* When an EpochEnded event comes
* update the database
* @param event EpochEnded event
* @param address The address of the Unirep contract
* @param provider An Ethereum provider
*/
const updateDBFromEpochEndedEvent = async (
    event: ethers.Event,
    unirepContract: ethers.Contract,
    startBlock: number  = DEFAULT_START_BLOCK,
) => {

    // The event has been processed
    if(event.blockNumber <= startBlock) return

    // update Unirep state
    const epoch = Number(event?.topics[1])

    // Get epoch tree leaves of the ending epoch
    let [epochKeys_, epochKeyHashchains_] = await unirepContract.getEpochTreeLeaves(epoch)
    epochKeys_ = epochKeys_.map((epk) => BigInt(epk).toString(16))
    epochKeyHashchains_ = epochKeyHashchains_.map((hc) => BigInt(hc).toString())
    
    const epochTreeLeaves: IEpochTreeLeaf[] = []
    for (let i = 0; i < epochKeys_.length; i++) {
        const epochTreeLeaf: IEpochTreeLeaf = {
            epochKey: epochKeys_[i],
            hashchainResult: epochKeyHashchains_[i]
        }
        epochTreeLeaves.push(epochTreeLeaf)
    }
    
    const newEpochTreeLeaves = new EpochTreeLeaves({
        epoch: epoch,
        epochTreeLeaves: epochTreeLeaves
    })

    const treeLeaves: IGSTLeaves = new GSTLeaves({
        epoch: epoch + 1,
        GSTLeaves: [],
        currentEpochGSTLeafIndexToInsert: 1
    })

    const EpochEndedEventResult = await newEpochTreeLeaves?.save()
    const savedTreeLeavesRes = await treeLeaves?.save()

    if(EpochEndedEventResult && savedTreeLeavesRes) {
        console.log('Database: saved epoch tree leaves and update current Epoch')
    }
}

// /*
// * When a UserstateTransitioned event comes
// * update the database
// * and insert a new leaf into GST
// * @param event UserstateTransitioned event
// */
// const updateDBFromUserStateTransitionEvent = async (
//     event: ethers.Event,
//     startBlock: number  = DEFAULT_START_BLOCK,
// ) => {

//     // The event has been processed
//     if(event.blockNumber <= startBlock) return

//     const _settings = await Settings.findOne()
//     if (!_settings) {
//         throw new Error('Error: should save settings first')
//     } 
//     const iface = new ethers.utils.Interface(Unirep.abi)
//     const _toEpoch = Number(event.topics[1])
//     const decodedUserStateTransitionedData = iface.decodeEventLog("UserStateTransitioned",event.data)
//     const _transactionHash = event.transactionHash
//     const _hashedLeaf = add0x(decodedUserStateTransitionedData?.userTransitionedData?.newGlobalStateTreeLeaf._hex)

//     // save new user transitioned state
//     const newUserState: IUserTransitionedState = new UserTransitionedState({
//         transactionHash: _transactionHash,
//         toEpoch: _toEpoch,
//         fromEpoch: decodedUserStateTransitionedData?.userTransitionedData?.fromEpoch._hex,
//         fromGlobalStateTree: decodedUserStateTransitionedData?.userTransitionedData?.fromGlobalStateTree._hex,
//         fromEpochTree: decodedUserStateTransitionedData?.userTransitionedData?.fromEpochTree._hex,
//         fromNullifierTreeRoot: decodedUserStateTransitionedData?.userTransitionedData?.fromNullifierTreeRoot._hex,
//         newGlobalStateTreeLeaf: _hashedLeaf,
//         proof: decodedUserStateTransitionedData?.userTransitionedData?.proof,
//         attestationNullifiers: decodedUserStateTransitionedData?.userTransitionedData?.attestationNullifiers,
//         epkNullifiers: decodedUserStateTransitionedData?.userTransitionedData?.epkNullifiers,
//     })

//     const UserStateTransitionedResult = await newUserState.save()

//     // save the new leaf
//     const newLeaf: IGSTLeaf = {
//         transactionHash: _transactionHash,
//         hashedLeaf: _hashedLeaf
//     }
    
//     let treeLeaves: IGSTLeaves | null = await GSTLeaves.findOne({epoch: _toEpoch})

//     if(!treeLeaves){
//         treeLeaves = new GSTLeaves({
//             epoch: _toEpoch,
//             GSTLeaves: [newLeaf],
//             currentEpochGSTLeafIndexToInsert: 1
//         })
//     } else {
//         const nextIndex = treeLeaves.currentEpochGSTLeafIndexToInsert + 1
//         treeLeaves.get('GSTLeaves').push(newLeaf)
//         treeLeaves.set('currentEpochGSTLeafIndexToInsert', nextIndex)
//     }

//     // save nullifiers
//     const attestationNullifiers = decodedUserStateTransitionedData?.userTransitionedData?.attestationNullifiers.map((n) => BigInt(n))
//     const epkNullifiers = decodedUserStateTransitionedData?.userTransitionedData?.epkNullifiers.map((n) => BigInt(n))
//     // Combine nullifiers and mod them
//     const allNullifiers = attestationNullifiers?.concat(epkNullifiers).map((nullifier) => BigInt(nullifier) % BigInt(2 ** _settings.nullifierTreeDepth))

//     for (let nullifier of allNullifiers) {
//         if (nullifier > BigInt(0)) {
//             assert(nullifier < BigInt(2 ** _settings.nullifierTreeDepth), `Nullifier(${nullifier}) larger than max leaf value(2**nullifierTreeDepth)`)
//             const findNullifier = await NullifierTreeLeaves.findOne({nullifier: nullifier})
//             assert(!findNullifier, `Nullifier(${nullifier}) seen before`)
//             const nullifierLeaf = new NullifierTreeLeaves({
//                 epoch: _toEpoch,
//                 nullifier: nullifier,
//                 transactionHash: _transactionHash
//             })
//             await nullifierLeaf.save()
//         }
//     }

//     const NewLeafInsertedResult = await treeLeaves?.save()

//     if(NewLeafInsertedResult && UserStateTransitionedResult){
//         console.log('Database: saved user transitioned state and inserted a new GST leaf')
//     }

// }



export {
    connectDB,
    initDB,
    disconnectDB,
    saveSettingsFromContract,
    genGSTreeFromDB,
    // genNullifierTreeFromDB,
    // genProveReputationCircuitInputsFromDB,
    // genProveReputationFromAttesterCircuitInputsFromDB,
    // genUserStateTransitionCircuitInputsFromDB,
    nullifierExists,
    getGSTLeaves,
    getEpochTreeLeaves,
    GSTRootExists,
    epochTreeRootExists,
    updateGSTLeaves,
    updateEpochTreeLeaves,
    saveNullifier,
    updateDBFromNewGSTLeafInsertedEvent,
    updateDBFromAttestationEvent,
    updateDBFromPostSubmittedEvent,
    updateDBFromCommentSubmittedEvent,
    // updateDBFromReputationNullifierSubmittedEvent,
    updateDBFromEpochEndedEvent,
    // updateDBFromUserStateTransitionEvent,
}