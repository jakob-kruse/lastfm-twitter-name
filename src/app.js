require("dotenv").config();
const fs = require("fs").promises;
const {join} = require("path");
const cron = require("node-cron");
const moment = require("moment");

// Check for required Enviroment Variables
const missingEnvVars = [
    "LASTFM_API_KEY",
    "LASTFM_SECRET",
    "LASTFM_TARGET_USER",
    "TWITTER_CONSUMER_KEY",
    "TWITTER_CONSUMER_SECRET",
    "TWITTER_ACCESS_TOKEN_KEY",
    "TWITTER_ACCESS_TOKEN_SECRET",
    "FALLBACK_TIMEOUT",
].filter((envKey) => !process.env[envKey]);

if (missingEnvVars.length > 0) {
    console.error(`PEBCAK: The following environment variables are missing: ${missingEnvVars.join(", ")}`);
    process.exit(1);
}

const Twitter = require("twitter");

const client = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const LastFm = require("lastfm-node-client");

const lastFm = new LastFm(
    process.env.LASTFM_API_KEY,
    process.env.LASTFM_API_SECRET
);

const cachePath = join(__dirname, "..", "trackCache.json");

function formatForTwitter(text) {
    text = text.trim();

    if (text.length > 41) {
        return `🎶 ${text.slice(0, 41)}... 🎶`;
    } else {
        return `🎶 ${text} 🎶`;
    }
}

async function setTwitterDescription(description) {
    const formattedDescription = formatForTwitter(description);

    return new Promise((resolve, reject) => {
        client.post("account/update_profile", {description: formattedDescription}, function (error) {
            if (error) {
                reject(error);
                return;
            }

            resolve(formattedDescription);
        });
    });
}

async function getCurrentTrack() {
    return new Promise((resolve, reject) => {
        lastFm
            .userGetRecentTracks({
                user: process.env.LASTFM_TARGET_USER,
            })
            .then((data) => {
                const track = data.recenttracks.track[0];

                if (!track) {
                    reject(new Error("No Track found"));
                    return;
                }

                resolve(`${track.artist["#text"]} - ${track.name}`);
            }).catch((e) => {
            console.log(`Something went wrong getting the current track: ${e.message}`);
        })
    });
}

async function loadCache() {
    let cache = null;
    try {
        cache = JSON.parse(await fs.readFile(cachePath, "utf-8"));
    } catch (e) {
        return {trackName: null, updatedAt: null};
    }

    return cache;
}

async function writeCache(cache) {
    const cacheString = JSON.stringify(cache);

    return fs.writeFile(cachePath, cacheString, "utf-8");
}

async function run() {
    const trackName = await getCurrentTrack();

    const cache = await loadCache();

    if (cache.trackName === trackName) {
        console.log("Track already present. Checking for inactivity....");
        if (cache.updatedAt !== null) {
            const cachedDate = moment(cache.updatedAt);
            const now = moment();

            const diffMinutes = now.diff(cachedDate, "minutes");
            const maxDiff = parseInt(process.env.FALLBACK_TIMEOUT);
            if (isNaN(maxDiff)) {
                console.error(
                    `PEBCAK: Invalid fallback timeout provided: "${process.env.FALLBACK_TIMEOUT}"`
                );
                process.exit(1);
            }

            if (diffMinutes >= maxDiff) {
                let name;
                try {
                    name = await setTwitterDescription(
                        process.env.TWITTER_FALLBACK_DESCRIPTION ?? ''
                    );
                }catch (e) {
                    console.log(`Something went wrong setting your twitter username: ${JSON.stringify(e)}`);
                    return;
                }

                console.log(
                    `Fallback due to inactivity. Set Twitter name to: "${name}"`
                );
                return;
            }

            console.log("Probably not inactive. Not doing anything");
        }
        return;
    }

    if (cache.trackName !== trackName) {
        let name;
        try {
            name = await setTwitterDescription(trackName);
        }catch (e) {
            console.log(`Something went wrong setting your twitter username: ${JSON.stringify(e)}`);
            return;
        }

        console.log(`Set Twitter name to: "${name}"`);
        cache.updatedAt = moment();
        cache.trackName = trackName;
    }

    await writeCache(cache);
}

run();

cron.schedule("* * * * *", run);