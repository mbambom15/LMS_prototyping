/* middleware check if user is logged impor'*/
function isAuthenticated(req, res, next){
    if(req.session.user){
        return next();
    }
    res.redirect('/login');
}

/*Check the corred=ct role */
function isRole(role) {
    return(req, res, next) => {

        if(req.session.user && req.session.user.role === role){
            return next();
        }
        res.status(403).send('Access denied. You are not allowed here');
    };
}
module.exports = { isAuthenticated, isRole};