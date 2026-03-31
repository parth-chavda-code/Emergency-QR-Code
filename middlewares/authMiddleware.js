import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

function authUser(req,res,next){
    console.log("IN Auth Middleware");
    try {
        const token = req.headers.token;
        const decodedToken = jwt.verify(token.id,process.env.JWT_SECRET);
        console.log(decodedToken);
        next();
    } catch (err) {
        return res.json({
            msg: "Error in auth middleware"
        });
    }


}