import { useState, useContext }  from 'react';

import { publishPost, getUserState } from '../../utils';
import { Post, DataType } from '../../constants';
import { WebContext } from '../../context/WebContext';
import { MainPageContext } from '../../context/MainPageContext';
import './mainPage.scss';
import WritingField from '../share/writingField';

const PostField = () => {

    const [epkNonce, setEpkNonce] = useState(0); // maybe it should be the first available epk

    const { user, setUser, shownPosts, setShownPosts } = useContext(WebContext);
    const { 
        isPostFieldActive, 
        setIsPostFieldActive,
        isPostFieldEpkDropdown, 
        setIsPostFieldEpkDropdown 
    } = useContext(MainPageContext);

    const init = () => {
        setIsPostFieldEpkDropdown(false);
        setIsPostFieldActive(false);
        setEpkNonce(0);
    }

    const preventPropagation = (event: any) => {
        event.stopPropagation();
    }

    const activateInput = (event: any) => {
        event.stopPropagation();
        setIsPostFieldActive(true);
    }

    const changeEpk = (epk: number) => {
        if (user != null) {
            setEpkNonce(epk);
            setIsPostFieldEpkDropdown(!isPostFieldEpkDropdown);
        }  
    }

    const submitPost = async (reputation: number, content: string) => {
        if (user === null) {
            console.log('not login yet.');
        } else if (content.length === 0) {
            console.error('not enter anything yet.');
        } else {
            const ret = await publishPost(content, epkNonce, user.identity, 0); // content, epkNonce, identity, minRep
            if (ret !== undefined) {
                const newPost: Post = {
                    type: DataType.Post,
                    id: ret.postId,
                    content,
                    vote: [],
                    upvote: 0,
                    downvote: 0,
                    isUpvoted: false,
                    isDownvoted: false,
                    epoch_key: ret.epk,
                    username: 'username',
                    post_time: Date.now(),
                    reputation,
                    comments: [],
                }
                init();

                setShownPosts([newPost, ...shownPosts]);
                const reputations = (await getUserState(user.identity)).userState.getRep();
                setUser({...user, reputations})
            } else {
                console.error('publish post error.');
            }
        }
    }

    return (
        <div className="post-field">
            {isPostFieldActive && user && user.identity ?
                <WritingField 
                    type={DataType.Post} 
                    setIsDropdown={setIsPostFieldEpkDropdown}
                    isDropdown={isPostFieldEpkDropdown}
                    epkNonce={epkNonce}
                    changeEpk={changeEpk}
                    submit={submitPost} 
                    submitBtnName="Post"
                    onClick={preventPropagation}
                /> : 
                <div className="post-field-before">
                    <div className="input-field" onClick={activateInput}>Share something!</div>
                </div>
            }
        </div>
    );
};

export default PostField;