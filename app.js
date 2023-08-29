const express = require("express");
const app = express();
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3003, () => {
      console.log("Server running at 3003");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const getFollowingIdsOfUser = async (username) => {
  const getFollowingPeopleQuery = `
        SELECT 
            following_user_id
        FROM follower
        INNER JOIN user 
        ON user.user_id = follower.follower_user_id
        WHERE 
            user.username = '${username}';`;

  const followersIds = await db.all(getFollowingPeopleQuery);
  const arrayOfIds = followersIds.map((each) => each.following_user_id);
  return arrayOfIds;
};

const authenticateToken = async (req, res, next) => {
  let jwtToken;
  const isHeaderHasToken = req.headers["authorization"];
  if (isHeaderHasToken !== undefined) {
    jwtToken = isHeaderHasToken.split(" ")[1];
  }
  if (jwtToken === undefined) {
    res.status(401);
    res.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secret_token", (error, payload) => {
      if (error) {
        res.status(401);
        res.send("Invalid JWT Token");
      } else {
        req.username = payload.username;
        req.userId = payload.userId;
        next();
      }
    });
  }
};

const tweetAccessVerification = async (req, res, next) => {
  const { userId } = req;
  const { tweetId } = req.params;
  const getTweetQuery = `
        SELECT 
          * 
        FROM tweet 
        INNER JOIN follower 
        ON tweet.user_id = follower.following_user_id
        WHERE 
            tweet.tweet_id = '${tweetId}'
        AND follower_user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next();
  }
};

//API 1
app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const getUserQuery = `
        SELECT * FROM 
        user WHERE username = '${username}';
    `;

  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
      res.status(400);
      res.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
            INSERT INTO 
                user (username, password, name, gender)
            VALUES
            (
                '${username}',
                '${hashedPassword}',
                '${name}',
                '${gender}'
            );
            `;
      await db.run(createUserQuery);
      res.status(200);
      res.send("User created successfully");
    }
  } else {
    res.status(400);
    res.send("User already exists");
  }
});

//API 2
app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const getUserQuery = `
        SELECT * FROM user 
        WHERE username = '${username}';
    `;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    res.status(400);
    res.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "secret_token");
      res.send({ jwtToken });
    } else {
      res.status(400);
      res.send("Invalid password");
    }
  }
});

//API 3
app.get("/user/tweets/feed/", authenticateToken, async (req, res) => {
  const { username } = req;
  const followingIds = await getFollowingIdsOfUser(username);
  const getTweetsFeedQuery = `
        SELECT 
        username,
        tweet,
        date_time AS dateTime
        FROM user
        INNER JOIN
        tweet ON
        user.user_id = tweet.user_id
        WHERE 
        user.user_id IN (${followingIds})
        ORDER BY date_time DESC
        LIMIT 4;        
        `;
  const tweetFeed = await db.all(getTweetsFeedQuery);
  res.send(tweetFeed);
});

//API 4
app.get("/user/following/", authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const followingUserQuery = `
        SELECT name FROM 
           follower
        INNER JOIN user
        ON user.user_id = follower.following_user_id
        WHERE follower_user_id = '${userId}';        
    `;

  const followingUser = await db.all(followingUserQuery);
  res.send(followingUser);
});

//API 5
app.get("/user/followers/", authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const userFollowersQuery = `
        SELECT DISTINCT name FROM 
           follower
        INNER JOIN user
        ON user.user_id = follower.follower_user_id
        WHERE following_user_id = '${userId}';
    `;
  const followers = await db.all(userFollowersQuery);
  res.send(followers);
});

//API 6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { username, userId } = req;
    const { tweetId } = req.params;

    const getTweetDetailsQuery = `
            SELECT 
                tweet,
                (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
                (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
                tweet.date_time AS dateTime
            FROM 
                tweet 
            WHERE 
                tweet.tweet_id = '${tweetId}';`;

    const tweetData = await db.get(getTweetDetailsQuery);
    res.send(tweetData);
  }
);

//API 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;

    const likedUsersQuery = `
        SELECT 
        username
        FROM user 
        INNER JOIN like 
        ON user.user_id = like.user_id
        WHERE 
            tweet_id = '${tweetId}';`;

    const likedUsers = await db.all(likedUsersQuery);
    const usersArray = likedUsers.map((like) => like.username);
    res.send({ likes: usersArray });
  }
);

//API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;

    const repliedUsersQuery = `
        SELECT 
        name,
        reply
        FROM user 
        INNER JOIN reply 
        ON user.user_id = reply.user_id
        WHERE 
           tweet_id = '${tweetId}';`;

    const repliedUsers = await db.all(repliedUsersQuery);
    res.send({ replies: repliedUsers });
  }
);

//API 9
app.get("/user/tweets/", authenticateToken, async (req, res) => {
  const { userId } = req;
  const tweetsDetailsQuery = ` 
        SELECT 
            tweet,
            COUNT(DISTINCT like_id) AS likes,
            COUNT(DISTINCT reply_id) AS replies,
            date_time as dateTime
        FROM tweet 
        LEFT JOIN reply 
        ON tweet.tweet_id = reply.tweet_id
        LEFT JOIN like 
        ON like.tweet_id = tweet.tweet_id
        WHERE 
            tweet.user_id = ${userId}
        GROUP BY 
            tweet.tweet_id;`;

  const tweetsDetails = await db.all(tweetsDetailsQuery);
  res.send(tweetsDetails);
});

//API 10
app.post("/user/tweets/", authenticateToken, async (req, res) => {
  const { tweet } = req.body;
  const userId = parseInt(req.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");

  const createTweetQuery = `
        INSERT INTO 
            tweet( tweet, user_id, date_time)
        VALUES 
            (
                '${tweet}',
                '${userId}',
                '${dateTime}'
                
            )`;
  await db.run(createTweetQuery);
  res.send("Created a Tweet");
});

//API 11
app.delete("/tweets/:tweetId/", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  const selectUserQuery = `SELECT 
                                   *
                                   FROM 
                                    tweet
                                 WHERE 
                                    tweet.user_id = '${userId}'
                                 AND tweet.tweet_id = '${tweetId}';`;
  const userTweet = await db.get(selectUserQuery);

  if (userTweet === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    const deleteTweetQuery = `
            DELETE FROM 
                tweet 
            WHERE 
            tweet.tweet_id = '${tweetId}';`;
    await db.run(deleteTweetQuery);
    res.send("Tweet Removed");
  }
});

module.exports = app;
