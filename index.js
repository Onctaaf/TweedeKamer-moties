const dotenv = require('dotenv');
const Twitter = require('twitter');
const fetch = require('node-fetch');
const mysql = require('mysql');
const moment = require('moment');
const cheerio = require('cheerio');
const fs = require('fs');
const fse = require('fs-extra')
var CronJob = require('cron').CronJob;
const htmlToImage = require('node-html-to-image');
const nodeHtmlToImage = require('node-html-to-image');
dotenv.config({ path: './config.env' });
var con = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "123qweasd",
    database: "tk_moties"
  });
  con.connect(function(err) {
    if (err) throw err;
    console.log("Connected!");
  });

var Twit = require('twit')
 
var T = new Twit({
  consumer_key:         process.env.TWITTER_CONSUMER_KEY,
  consumer_secret:      process.env.TWITTER_CONSUMER_SECRET,
  access_token:         process.env.TWITTER_ACCESS_KEY,
  access_token_secret:  process.env.TWITTER_ACCESS_SECRET,

})

// CRON JOB PART
var job = new CronJob(
	'0,30 * * * *',
	function() {
		every30minutes().then(() => {console.log(`Done with every30minutes() at ${moment().format(`yyyy-MM-DDTHH:mm`)}`)});
	},
	null,
	true,
	'America/Los_Angeles'
);


const shareMotie = async (filename, tweetText) => {
    let b64content = fs.readFileSync(`./images/${filename}.png`, { encoding: 'base64' });
    //return console.log("we not tweeting boys")
    T.post('media/upload', { media_data: b64content }, function (err, data, response) {
        // now we can assign alt text to the media, for use by screen readers and
        // other text-based presentations and interpreters
        var mediaIdStr = data.media_id_string
        var altText = "TweedeKamer motie/amendement stemmingen"
        var meta_params = { media_id: mediaIdStr, alt_text: { text: altText } }
        
        T.post('media/metadata/create', meta_params, function (err, data, response) {
            if (!err) {
            // now we can reference the media and post a tweet (media will attach to the tweet)
            var params = { status: `${tweetText}`, media_ids: [mediaIdStr] }
        
            T.post('statuses/update', params, function (err, data, response) {
                console.log(data)
            })
            }
        })
    })
}

    String.prototype.replaceAt = function(index, replacement) {
        return this.substring(0, index) + replacement + this.substring(index + replacement.length);
    }

const every30minutes = async () => {

    fse.emptyDirSync('./images', err => {
        if (err) return console.error(err)
        // console.log('success')
    });

    let moties = await newMotiesThisHour();
    //for each new motie get the stemmingen using it's Besluit_Id
    
    for (let i = 0; i < await moties.value.length; i++) {
        // wait for the previous iteration to finish
        await new Promise(resolve => setTimeout(resolve, 1000));
        let motie = await moties.value[i];
        const zaak = motie.Zaak
        let besluitId = await motie.Id;
        // let zaak_id = await motie.Zaak.Id;
        //if besluitId is not in the database

        let stemmingen = await getStemmingen(besluitId);
        console.log(`${await stemmingen.value.length} stemmingen gevonden voor motie ${await besluitId}`)
        // if(await stemmingen.value.length > 0 && stemmingen.value.length < 30) {
            // console.log(motie.Zaak)
            let checkIfExists = await con.query(`SELECT * FROM verwerkt WHERE Besluit_Id = '${besluitId}'`, async function (err, result) {
                if (err) throw err;

                if (result.length === 0) {
                    if(await stemmingen.value.length > 0 && stemmingen.value.length < 30) {
                    //insert besluitId in the database
                    con.query(`INSERT INTO verwerkt (Besluit_Id) VALUES ('${besluitId}')`, function (err, result) {
                        if (err) throw err;
                    });
                    //get the stemmingen from the API
                        createStemmingImg(stemmingen, zaak);
                    


                    } else if (stemmingen.value.length >= 30){
                        console.log("Hoofdelijke stemming. Overslaan voor nu.")
                        con.query(`INSERT INTO verwerkt (Besluit_Id) VALUES ('${besluitId}')`, function (err, result) {
                            if (err) throw err;
                        });
                        createStemmingImgHoofdelijk(stemmingen, zaak);
                    }
                    // console.log(await stemmingen);
                } else{
                    console.log("already exists");
                }
            });
        // } else if (stemmingen.value.length >= 30){
        //     console.log("Hoofdelijke stemming. Overslaan voor nu.")
        //     con.query(`INSERT INTO verwerkt (Besluit_Id) VALUES ('${besluitId}')`, function (err, result) {
        //         if (err) throw err;
        //     });
        // }
    }
}


const newMotiesThisHour = async () => {
    const currentYear = moment().format('YYYY');
    const currentMonth = moment().format(`MM`);
    const currentDay = moment().format(`DD`);
    const currentHour = new Date().getHours();
    const currentMinute = new Date().getMinutes();
    const currentDate = new Date().getTime();
    var testtime = moment().format(`yyyy-MM-DDTHH:mm`)
    var currentDateTime = testtime + ":00.0-02:00"
    console.log(currentDay < 2)
    if (parseInt(currentDay) < 2) {
        currentDateTime = currentDateTime.replaceAt(6, `${currentMonth - 1}`)
        currentDateTime = currentDateTime.replaceAt(8, `29`)
        if (currentMonth - 1 === 0) {
            currentDateTime = currentDateTime.replaceAt(5, `12`)
            currentDateTime = currentDateTime.replaceAt(7, `${currentYear - 1}`)
        }
        //if it's february change the day to 28
        if (currentMonth - 1 === 1) {
            currentDateTime = currentDateTime.replaceAt(8, `27`)
        }
    } else {
        console.log(currentDateTime)
        console.log(currentDay.length > 10)
        let replacement =  currentDay - 2
        if(parseInt(currentDay) > 10){
            currentDateTime = currentDateTime.replaceAt(8, `${replacement}`)
        } else {
            currentDateTime = currentDateTime.replaceAt(9, `${replacement}`)
        }
        console.log(currentDateTime)
    }
    try {
        console.log(            `https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Besluit?$filter=Verwijderd eq false and (BesluitSoort eq 'Stemmen - aangenomen' or BesluitSoort eq 'Stemmen - verworpen') and GewijzigdOp ge ${currentDateTime}&$orderby=GewijzigdOp desc&$expand=Zaak`
        )
        const newMotiesRes = await fetch(
            `https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Besluit?$filter=Verwijderd eq false and (BesluitSoort eq 'Stemmen - aangenomen' or BesluitSoort eq 'Stemmen - verworpen') and GewijzigdOp ge ${currentDateTime}&$orderby=GewijzigdOp desc&$expand=Zaak`
        )
        const data = await newMotiesRes.json();
        console.log(await data)
        return await data;
    } catch (error) {
        console.log(error);
    }
};

const getStemmingen = async (Besluit_Id) => {
    try {
        const stemmingenRes = await fetch(
            `https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Stemming?$filter=Besluit_Id eq ${Besluit_Id}`
        )
        const data = await stemmingenRes.json();
        // console.log(data);
        return data;
    } catch (error) {
        console.log(error);
    }
};

const createStemmingImgHoofdelijk = async (stemmingen, zaak) => {
    let actorFractieDict = {};
    // console.log(stemmingen)
    // console.log(zaak[0].Titel)
    //populate actorFractieDict with all stemmingen.value.actorFractie as key and stemmingen.value.soort as value
    let StemmenVoor = 0;
    for (let i = 0; i < await stemmingen.value.length; i++) {
        let stemming = await stemmingen.value[i];
        if(stemming.ActorFractie in actorFractieDict) {
        } else{
            actorFractieDict[stemming.ActorFractie] = [stemming.FractieGrootte, 0, 0, 0];
        }
        if(stemming.Soort === "Voor"){
            StemmenVoor = StemmenVoor + 1;
            actorFractieDict[stemming.ActorFractie][1] += 1;
        } else if(stemming.Soort === "Tegen"){
            actorFractieDict[stemming.ActorFractie][2] += 1;
        } else {
            actorFractieDict[stemming.ActorFractie][3] += 1;
        }
    }
    // return console.log(actorFractieDict);
    const keys = Object.keys(actorFractieDict);
    // console.log(keys);
    let generationHTML = fs.readFileSync("./generation_hoofdelijk.html", "utf8");
    const cheeriofile = cheerio.load(generationHTML);
    var Onderwerp = zaak[0].Onderwerp
    if(zaak[0].Onderwerp.startsWith("Motie van het ")){
        Onderwerp = zaak[0].Onderwerp.replace("Motie van het ", "");
    }
    // Onderwerp = zaak[0].Onderwerp + "t ere jn jfnkja fnjka najdnkjfn skajdfnsa kn";
    if (Onderwerp.length > 90) {
        Onderwerp = Onderwerp.substring(0, 90) + "...";
    }
    cheeriofile('#motienr').text(Onderwerp);
    keys.sort().forEach((key, index) => {
        const value = actorFractieDict[key];
        const fractiegrootte = value[1];
        let verhouding = `<span class="ongekend"><span class="Voor">${Lamount(value[1])}</span><span class="Tegen">${Lamount(value[2])}</span>${Lamount(value[3])}</span>`
            cheeriofile('.stemmingen').append(`
                <div class="stemming">
                        <p class="fractie">${key}</p>
                        <p class=" verhouding">${verhouding}</p>
                    </div>`
            )
        
    }) 
    // console.log(StemmenVoor);
    cheeriofile('#stemmenVoor').text(StemmenVoor);
    cheeriofile('#greenbar').css('width', `${(StemmenVoor/150)*100}%`);
    generationHTML = cheeriofile.html();
    console.log("Creating image")
    
    nodeHtmlToImage({
        output: `./images/${zaak[0].Nummer}.png`,
        selector: '.container',
        puppeteerArgs: {executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox']},
        beforeScreenshot: function (page) {
            page.setViewport({
                width: 800,
                height: 800,
                deviceScaleFactor: 3,
            });
            
        },
        html: `${generationHTML}`
    }).then(() => shareMotie(zaak[0].Nummer, TweetText)).catch(err => console.error('Something went wrong:', err));
    var TweetOnderwerp = zaak[0].Onderwerp
    if (TweetOnderwerp.length > 235) {
        TweetOnderwerp = TweetOnderwerp.substring(0, 235) + "...";
    }
    if(StemmenVoor > 75){
        motiestatus = "aangenomen"
    } else{
        motiestatus = "verworpen"
    }
    const TweetText = `${TweetOnderwerp}, is ${motiestatus}. #TweedeKamer #motie`;
    // console.log(TweetText)
    // shareMotie(zaak[0].Nummer, TweetText);
}

const createStemmingImg = async (stemmingen, zaak) => {
    let actorFractieDict = {};
    // console.log(zaak[0].Titel)
    //populate actorFractieDict with all stemmingen.value.actorFractie as key and stemmingen.value.soort as value
    for (let i = 0; i < await stemmingen.value.length; i++) {
        let stemming = await stemmingen.value[i];
        actorFractieDict[stemming.ActorFractie] = [stemming.Soort, stemming.FractieGrootte];
    }
    const keys = Object.keys(actorFractieDict);
    // console.log(keys);
    let StemmenVoor = 0;
    let generationHTML = fs.readFileSync("./generation.html", "utf8");
    const cheeriofile = cheerio.load(generationHTML);
    var Onderwerp = zaak[0].Onderwerp
    if(zaak[0].Onderwerp.startsWith("Motie van het ")){
        Onderwerp = zaak[0].Onderwerp.replace("Motie van het ", "");
    }
    // Onderwerp = zaak[0].Onderwerp + "t ere jn jfnkja fnjka najdnkjfn skajdfnsa kn";
    if (Onderwerp.length > 90) {
        Onderwerp = Onderwerp.substring(0, 90) + "...";
    }
    cheeriofile('#motienr').text(Onderwerp);
    keys.sort().forEach((key, index) => {
        const value = actorFractieDict[key];
        const fractiegrootte = value[1];
        if(value[0] === "Voor"){
            StemmenVoor += parseInt(fractiegrootte);
            cheeriofile('.stemmingen').append(`
                <div class="stemming">
                    <span class="material-icons material-io voor">check_circle</span>
                    <p class="fractie">${key}</p>
                </div>`
            )
        } else if (value[0] === "Tegen"){
            cheeriofile('.stemmingen').append(`
                <div class="stemming">
                    <span class="material-icons material-io tegen">cancel</span>
                    <p class="fractie">${key}</p>
                </div>`
            )
            
        } else{
            cheeriofile('.stemmingen').append(`
                <div class="stemming">
                    <span class="material-icons material-io ongekend">help</span>
                    <p class="fractie">${key}</p>
                </div>`
            )
        }
        
    }) 
    // console.log(StemmenVoor);
    cheeriofile('#stemmenVoor').text(StemmenVoor);
    cheeriofile('#greenbar').css('width', `${(StemmenVoor/150)*100}%`);
    generationHTML = cheeriofile.html();
    console.log("Creating image")
    
    nodeHtmlToImage({
        output: `./images/${zaak[0].Nummer}.png`,
        selector: '.container',
        puppeteerArgs: {
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        },
        beforeScreenshot: function (page) {
            page.setViewport({
                width: 800,
                height: 800,
                deviceScaleFactor: 3,
            });
            
        },
        html: `${generationHTML}`
    }).then(() => shareMotie(zaak[0].Nummer, TweetText)).catch(err => console.error('Something went wrong:', err));
    var TweetOnderwerp = zaak[0].Onderwerp
    if (TweetOnderwerp.length > 235) {
        TweetOnderwerp = TweetOnderwerp.substring(0, 235) + "...";
    }
    if(StemmenVoor > 75){
        motiestatus = "aangenomen"
    } else{
        motiestatus = "verworpen"
    }
    const TweetText = `${TweetOnderwerp}, is ${motiestatus}. #TweedeKamer #motie`;
    // console.log(TweetText)
    // shareMotie(zaak[0].Nummer, TweetText);
}

//create Lamount function
const Lamount = (x) => {
    //return a string with x amount of l's
    let l = "";
    for (let i = 0; i < x; i++) {
        l += "l";
    }
    return l;
}

let d = new Date();
every30minutes().then(() => {console.log(`Done with every30minutes() at ${moment().format(`yyyy-MM-DDTHH:mm`)}`)});
