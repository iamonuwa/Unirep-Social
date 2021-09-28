import { useState, useContext }  from 'react';
import { WebContext } from '../../context/WebContext';
import Dropdown from './dropdown';
import { DataType, ChoiceType } from '../../constants';
import './writingField.scss';
import { DEFAULT_POST_KARMA, DEFAULT_COMMENT_KARMA } from '../../config';


type Props = {
    type: DataType,
    epkNonce: number,
    changeEpk: (epkNonce: number) => void,
    submit: (rep: number, content: string) => void,
    submitBtnName: string,
    onClick: (event: any) => void,
}

const WritingField = (props: Props) => {

    const defaultRep = props.type === DataType.Post? DEFAULT_POST_KARMA : DEFAULT_COMMENT_KARMA;

    const { user } = useContext(WebContext);
    const [ reputation, setReputation ] = useState(defaultRep);
    const [ content, setContent ] = useState('');
    const [ errorMsg, setErrorMsg ] = useState('');
    const [ isDropdown, setIsDropdown ] = useState(false);

    const switchDropdown = (event: any) => {
        props.onClick(event);
        setIsDropdown(!isDropdown);
    }

    const changeReputation = (event: any) => {
        if (event.target.value === '') {
            setReputation(defaultRep);
        } else {
            setReputation(event.target.value);
        }
        setErrorMsg('');
    }

    const onClickField = (event: any) => {
        props.onClick(event);
        setIsDropdown(false);
    }

    const handleUserInput = (event: any) => {
        setContent(event.target.value);
        setErrorMsg('');
    }

    const submit = () => {
        if (user === null) {
            setErrorMsg('Please sign up or sign in');
        } else if (isNaN(reputation)) {
            setErrorMsg('Please input reputation in number');
        } else if (user.reputations < defaultRep) {
            setErrorMsg('Sorry. You don\'t have enough reputation to perform post action.');
        } else if (reputation < defaultRep || reputation > user.reputations) {
            setErrorMsg('Please input reputation between ' + defaultRep + ' and ' + user.reputations);
        } else if (content.length === 0) {
            setErrorMsg('Please share something in order to post');
        } else {
            props.submit(reputation, content);
        }
    }

    return (
        <div className="writing-field" onClick={onClickField}>
            <textarea name="userInput" placeholder="Share something!" onChange={handleUserInput}></textarea>
            <div className="setting-area">
                <div className="setting-epk">
                    <label>Select an Epoch Key to display with your post <span>?</span></label>
                    { user !== null? 
                        <Dropdown 
                            type={ChoiceType.Epk}
                            defaultChoice={user.epoch_keys[props.epkNonce]}
                            choices={user.epoch_keys}
                            onChoose={props.changeEpk}
                            isDropdown={isDropdown}
                            setIsDropdown={setIsDropdown}
                        /> : <div></div>
                    }
                </div>
                <div className="setting-reputation">
                    <label>{"Enter a reputation score " + defaultRep + " or greather (optional)"} <span>?</span></label>
                    <br/>
                    <textarea name="repInput" placeholder={"MAX " + user?.reputations} onChange={changeReputation}></textarea>
                </div>
            </div>
            {
                errorMsg.length > 0? 
                <div className="error">
                    <img src="/images/warning.png" />
                    <span>{errorMsg}</span>
                </div> : <div></div>
            }
            <div className="submit-btn" onClick={submit}>
                {props.submitBtnName}
            </div>
            <div className="note">
                {props.type === DataType.Post? 
                    "Posting will use " + defaultRep + " reputation points" : 
                    "Commenting will use " + defaultRep + " reputation points" }
            </div>
        </div>
    );
}

export default WritingField;