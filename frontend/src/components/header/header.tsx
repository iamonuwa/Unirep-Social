import React, { useContext, useState } from 'react';
import { NavLink, useHistory } from 'react-router-dom';
import { WebContext } from '../../context/WebContext';
import * as Constants from '../../constants';
import { Post } from '../../constants';
import { getUserState } from '../../utils';
import './header.scss';

const Header = () => {
    const history = useHistory();

    const { user, setUser, setPageStatus, shownPosts, setShownPosts } = useContext(WebContext);
    const [searchInput, setSearchInput] = useState<string>("");

    const signUp = () => {
        console.log('open sign up! set ' + Constants.PageStatus.SignUp);
        setPageStatus(Constants.PageStatus.SignUp);
    }

    const signIn = () => {
        console.log('open sign in! set ' + Constants.PageStatus.SignIn);
        setPageStatus(Constants.PageStatus.SignIn);
    }

    const logout = () => {
        setUser(null);
        setShownPosts([...shownPosts].map(p => {
            const commentsLogout = p.comments.map(c => {
                return {...c, isUpvoted: false, isDownvoted: false};
            });
            return {...p, isUpvoted: false, isDownvoted: false, comments: commentsLogout};
        }));
    }

    const handleSearchInput = (event: any) => {
        console.log("search input : " + event.target.value);
    }

    return (
        <header>
            <div className="navLinks">
                <NavLink to="/" className="link" activeClassName="active" exact>
                    UNIREP SOCIAL
                </NavLink>
            </div>
            {/* <div className="search-bar">
                <div className="search-icon"><FaSearch /></div>
                <form>
                    <input type="text" name="searchInput" placeholder="Search by keyword, user names or epoch key" onChange={handleSearchInput} />
                </form>
            </div> */}
            {user && user.identity? 
                <div className="navButtons">
                    <div className="purpleButton" onClick={() => history.push(`/user`)}>{user.reputations}</div>
                    <div className="whiteButton" onClick={logout}>Log out</div>
                </div> :
                <div className="navButtons">
                    <div className="purpleButton" onClick={signUp}> Sign Up</div>
                    <div className="whiteButton" onClick={signIn}> Sign In</div>
                </div>
                
            }   
        </header>
    );
}

export default Header;