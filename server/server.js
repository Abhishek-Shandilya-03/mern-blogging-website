import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import cors from "cors";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import firebaseAdmin from "firebase-admin";
import fs from "fs";
import aws from "aws-sdk";

const serviceAccountKey = JSON.parse(
  fs.readFileSync(
    "./react-blogging-website-4bece-firebase-adminsdk-fbsvc-4375490d59.json",
    "utf-8"
  )
);

//schema
import User from "./Schema/User.js";
import Blog from "./Schema/Blog.js";
import { count } from "console";

const server = express();
let PORT = 3000;
const { credential } = firebaseAdmin;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey),
});

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/; // regex for password

server.use(express.json());
server.use(cors());

mongoose.connect(process.env.DB_LOCATION, {
  autoIndex: true,
});

//setting up s3 bucket
const s3 = new aws.S3({
  region: "ap-south-1",
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const generateUploadURL = async () => {
  const date = new Date();
  const imageName = `${nanoid()}-${date.getTime()}.jpeg`;

  return await s3.getSignedUrlPromise("putObject", {
    Bucket: "react-blogging-website",
    Key: imageName,
    Expires: 1000,
    ContentType: "image/jpeg",
  });
};

//verify user logged in via JWT
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    return res.status(401).json({ error: "No access token" });
  }

  jwt.verify(token, process.env.SECRET_ACCESS_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Access token invalid" });
    }

    req.user = user.id;
    next();
  });
};

//formated data to send
const formatDataToSend = (user) => {
  const access_token = jwt.sign(
    { id: user._id },
    process.env.SECRET_ACCESS_KEY
  );
  return {
    access_token,
    profile_img: user.personal_info.profile_img,
    username: user.personal_info.username,
    fullname: user.personal_info.fullname,
  };
};

const generateUserName = async (email) => {
  let username = email.split("@")[0];

  let isUserNameNotUnique = await User.exists({
    "personal_info.username": username,
  }).then((res) => res);

  if (isUserNameNotUnique) {
    const uniqueSuffix = nanoid().substring(0, 5);
    username += uniqueSuffix;
  }

  return username;
};

//s3 upload image url
server.get("/get-upload-url", (req, res) => {
  generateUploadURL()
    .then((url) => {
      res.status(200).json({ uploadUrl: url });
    })
    .catch((err) => {
      console.log(err.message);
      res.status(500).json({ error: err.message });
    });
});

//signup
server.post("/signup", (req, res) => {
  let { fullname, email, password } = req.body;

  //Validate data from frontend
  if (fullname.length < 3) {
    return res
      .status(403)
      .json({ error: "Fullname must be at least 3 characters long" });
  }

  if (!email.length) {
    return res.status(403).json({ error: "Email is required" });
  }

  if (!emailRegex.test(email)) {
    return res.status(403).json({ error: "Invalid email" });
  }

  if (passwordRegex.test(password)) {
    return res.status(403).json({
      error:
        "Password must contain at least one uppercase letter, one lowercase letter and one number and 6-20 characters ",
    });
  }

  //Hash password
  bcrypt.hash(password, 10, async (err, hashed_password) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "An error occurred while hashing password" });
    }
    password = hashed_password;
    let username = await generateUserName(email);

    let user = new User({
      personal_info: {
        fullname,
        email,
        password,
        username,
      },
    });

    user
      .save()
      .then((user) => {
        return res.status(200).json(formatDataToSend(user));
      })
      .catch((err) => {
        console.log(err);

        if (err.code == 11000) {
          return res.status(500).json({ error: "Email already exists" });
        }

        return res.status(500).json({ error: err.message });
      });
  });
});

server.post("/signin", (req, res) => {
  let { email, password } = req.body;

  User.findOne({ "personal_info.email": email })
    .then((user) => {
      if (!user) {
        return res.status(404).json({ error: "Email not found" });
      }

      if (!user.google_auth) {
        bcrypt.compare(password, user.personal_info.password, (err, result) => {
          if (err) {
            return res
              .status(500)
              .json({ error: "An error occurred while login" });
          }

          if (!result) {
            return res.status(403).json({ error: "Password is incorrect" });
          } else {
            return res.json(formatDataToSend(user));
          }
        });
      } else {
        return res
          .status(403)
          .json({
            error: "Email already exists please use google to access account",
          });
      }
    })
    .catch((err) => {
      console.log(err);
      return res.status(500).json({ error: err.message });
    });
});

server.post("/google-auth", async (req, res) => {
  let { access_token } = req.body;

  getAuth()
    .verifyIdToken(access_token)
    .then(async (decodedUser) => {
      let { email, name, picture } = decodedUser;

      picture = picture.replace("s96-c", "s384-c");

      let user = await User.findOne({ "personal_info.email": email })
        .select(
          "personal_info.fullname personal_info.username personal_info.profile_img google_auth"
        )
        .then((u) => {
          return u || null;
        })
        .catch((err) => {
          return res.status(500).json({ error: err.message });
        });

      if (user) {
        if (!user.google_auth) {
          return res
            .status(403)
            .json({
              error:
                "Email already exists please use password to access account",
            });
        }
      } else {
        let username = await generateUserName(email);

        user = new User({
          personal_info: { fullname: name, email, username },
          google_auth: true,
        });

        await user
          .save()
          .then((u) => {
            user = u;
          })
          .catch((err) => {
            return res.status(500).json({ error: err.message });
          });
      }

      return res.status(200).json(formatDataToSend(user));
    })
    .catch((err) => {
      return res
        .status(500)
        .json({
          error: "Failed to authenticate with google try with another account",
        });
    });
});

//latest blogs

server.post("/latest-blogs", (req,res) => {

  let { page } = req.body

  let maxLimit = 5


  Blog.find({ draft: false})
  .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"publishedAr": -1})
  .select("blog_id title des banner activity tags publishedAt -_id")
  .skip((page-1) * maxLimit)
  .limit(maxLimit)
  .then(blogs => {
    return res.status(200).json({ blogs })
  })
  .catch(err => {
    return res.status(500).json({ error: err.message})
  })

})

//all-latest-blogs-count

server.post("/all-latest-blogs-count", (req,res) => {
  Blog.countDocuments({ draft: false})
  .then(count => {
    return res.status(200).json({ totalDocs: count })
  })
  .catch(err => {
    console.log(err.message)
    return res.status(500).json({error: err.message})
  })
})

//search-blogs-count

server.post("/search-blogs-count", (req,res) => {
  let { tag, query } = req.body

  let findQuery;

   if(tag){
    findQuery = { tags: tag, draft: false };
  }else if(query){
    findQuery = { draft: false, title: new RegExp(query, 'i')}
  }

  Blog.countDocuments(findQuery)
  .then(count => {
    return res.status(200).json({totalDocs: count})
  })
  .catch(err =>{

    console.log(err.message)
    return res.status(500).json({error: err.message})
  })
})

//search users 

server.post("/search-users", (req,res) =>{
  let { query } = req.body;

  User.find({ "personal_info.username": new RegExp(query, 'i')})
  .limit(50)
  .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
  .then( users => {
    return res.status(200).json({ users })
  })
  .catch( err => {
    res.status(500).json({error: err.message})
  })
})

//trending blogs

server.get("/trending-blogs", (req, res) => {
  Blog.find({ draft: false})
  .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"activity.total_read": -1, "activity.total_likes": -1, "publishedAt": -1})
  .select("blog_id title publishedAt -_id")
  .limit(5)
  .then(blogs => {
    return res.status(200).json( { blogs });
  })
  .catch(err => {
    return res.status(500).json({err: err.message});
  })
})

//Search blogs 

server.post("/search-blogs", (req, res) => {
  let { tag, query, page } = req.body;

  let findQuery;

  if(tag){
    findQuery = { tags: tag, draft: false };
  }else if(query){
    findQuery = { draft: false, title: new RegExp(query, 'i')}
  }

  let maxLimit = 5;

  Blog.find(findQuery)
  .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"publishedAr": -1})
  .select("blog_id title des banner activity tags publishedAt -_id")
  .skip((page-1) * maxLimit)
  .limit(maxLimit)
  .then(blogs => {
    return res.status(200).json({ blogs })
  })
  .catch(err => {
    return res.status(500).json({ error: err.message})
  })
})

//blog route

server.post("/create-blog", verifyJWT, (req, res) => {
  let authorId = req.user;

  let { title, banner, des, tags, content, draft } = req.body;

  
  if (!title.length) {
    return res
      .status(404)
      .json({ error: "You must provide a title" });
  }


  if(!draft){
    if (!des.length || des.length > 200) {
      return res
        .status(404)
        .json({ error: "Blog description should be of 200 chars only" });
    }
  
    if (!banner.length) {
      return res
        .status(404)
        .json({ error: "Banner required to publish the blog" });
    }
  
    if(!content.blocks.length){
      return res.status(404).json({error: "There must be some content to publish"})
  
    }
  
    if(!tags.length){
      return res.status(404).json({error: "Provide tags to publish blog"})
  
    }
  }

  

  tags = tags.map(tag => tag.toLowerCase());

  let blog_id = title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, "-").trim() + nanoid();


  let blog = new Blog(
    {
      title,
      des,
      banner,
      content,
      tags,
      author: authorId,
      blog_id,
      draft: Boolean(draft)
    }
  )

  blog.save().then(blog => {
    let incrementVal = draft ? 0 : 1;

    User.findOneAndUpdate({ _id: authorId }, { $inc : {"account_info.total_posts" : incrementVal}, $push : { "blogs": blog._id } })
    .then(user => {
      return res.status(200).json({ id: blog.blog_id});
    })
    .catch(err => {
      return res.status(500).json({ error: "Failed to update total posts number"});
    })

  })
  .catch(err =>{
    return res.status(500).json({error: err.message});
  })

});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
