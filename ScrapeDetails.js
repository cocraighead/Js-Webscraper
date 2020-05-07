//const puppeteer = require("puppeteer-extra");
const puppeteer = require("puppeteer");
//const pluginStealth = require("puppeteer-extra-plugin-stealth")
//puppeteer.use(pluginStealth())
const Airtable = require('airtable');

const base = new Airtable({apiKey: 'key6Tigoyr6fyc4sK'}).base('appUi0FWGnwnFB3ve');
const startupView = base('Startup');
const detailsView = base('Detailed Startup Table');
const foundersView = base('Founders Table');


// Function loops throught the startups in the 'Startup' table and calls other functions to go and scrape their page on Angel List
// The scraped data is cleaned so that a new row in 'Detailed Startup Table' can be created in Air Table
// and rows for each founder can be created in Air Table
// Params:
// Return:
function main(){
  return startupView.select({
  }).eachPage(async function page(records, fetchNextPage) {
    for(let i = 0;i<records.length;i++){
      // Checks to see if the row is already linked to a detailed page if so we don't want to rescrape it
      if(records[i].get('Detailed Startup') == null){
        let rec_id = records[i].getId();
        let dirty_scraped_obj = await scrapeDeatPage(records[i]);
        if(dirty_scraped_obj == null){
          continue;
        }
        let clean_scraped_obj = await cleanObj(dirty_scraped_obj);
        let deat_rec = await writeDeatAT(rec_id, clean_scraped_obj);
        let deat_id = deat_rec.getId();
        let all_founders_rec = await writeFoundersAT(rec_id, deat_id, clean_scraped_obj);
      }
    }
    await fetchNextPage();
  });
}

// Function opens the browser and scrapes all the needed innerText and href of the wanted html elements
// Param: Passed_record is a row from the 'Startup Table'
// Return: A object with: full pitch, num employees, tags innerText. href of 3 social media links. And arrays: founders and team members innerText
async function scrapeDeatPage(passed_record){
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();
  // Blocks extra get requests
  await page.setRequestInterception(true);
  await page.on('request', (request) => {
    const req_url = request.url();
    const keep = [
        'angel.co'
    ];
    const should_keep = keep.some((url_part) => req_url.includes(url_part));
    if (should_keep && !(request.resourceType() === 'image' || request.resourceType() === 'stylesheet' || request.resourceType() === 'font')){
      request.continue();
    }else{
      request.abort();
    }
  });
  const angel_url = passed_record.get('Angel Url');
  await page.goto(angel_url);
  await console.log(`Going to url: ${angel_url}`);
  // This class will always load for the normal page look but in the case of the strange html load it will time out - Changed from .js-company_size
  try{
    await page.screenshot({ path: "testresult.png", fullPage: true })
    await page.waitForSelector('#layouts-base-body', {timeout:5000});
  }catch(err){
    await console.log(err);
    return await scrapeDeatPage_strange(page);
  }
  // Pitch needs to be expanded by a mouse click in cases where there is a large amount of text
  /*
  let pitch_box = await page.$('.show > .content');
  if(pitch_box != null){
    let more_button = await page.$('.content > a.hidden_more');
    if(more_button != null){
      await page.click('a.hidden_more');
    }
  }
*/
  // Scrapes all the wanted data points on the page into an object
  unformatted_detail_obj = await page.evaluate(() => {

    // Also full pitch will be null when there is no pitch or when complex/custom html was created
    let full_pitch = '';
    if(document.querySelector('.show > .content') != null){
      full_pitch = document.querySelector('.show > .content').innerText;
    }

    // For num employees, the div will be found but be in a u-hidden class if there isnt a value
    // This if checks for ^
    let num_employees = '';
    if(document.querySelector('.js-company_size') != null){
      if(document.querySelector('.u-hidden > .js-company_size') == null){
        num_employees = document.querySelector('.js-company_size').innerText;
      }
    }

    let all_tags = '';
    if(document.querySelector('.js-market_tags') != null){
      all_tags = document.querySelector('.js-market_tags').innerText;
    }

    let all_locations = '';
    if(document.querySelector('.js-location_tags') != null){
      all_locations = document.querySelector('.js-location_tags').innerText;
    }

    let twitter = '';
    if(document.querySelector('.u-uncoloredLink.twitter_url') != null){
      twitter = document.querySelector('.u-uncoloredLink.twitter_url').href
    }

    let facebook = '';
    if(document.querySelector('.u-uncoloredLink.facebook_url') != null){
      facebook = document.querySelector('.u-uncoloredLink.facebook_url').href;
    }

    let linkedIn = '';
    if(document.querySelector('.u-uncoloredLink.linkedin_url') != null){
      linkedIn = document.querySelector('.u-uncoloredLink.linkedin_url').href;
    }

    //Checks for founders and if there are none checks for the team
    let founders_element_array = [];
    let team_element_array = [];
    if(document.querySelector('.founders.header') != null){
      founders_element_array = document.querySelectorAll('.founders.section .name');
    }else if(document.querySelector('.header.team') != null){
      team_element_array  = document.querySelectorAll('.team.section .name');
    }else{
      console.log('no team or founders case');
    }
    // Takes the SelectAll query results for Founders and Teams members and places the names as text into an array
    let founders_string_array = [];
    for(let i = 0;i < founders_element_array.length; i++){
      founders_string_array.push(founders_element_array[i].innerText);
    }
    let team_string_array = [];
    for(let i = 0;i < team_element_array.length; i++){
      team_string_array.push(team_element_array[i].innerText);
    }
    return {
      d_full_pitch: full_pitch,
      d_num_emp: num_employees,
      d_tags: all_tags,
      d_twitter: twitter,
      d_locations: all_locations,
      d_facebook: facebook,
      d_linkedIn: linkedIn,
      d_founders: founders_string_array,
      d_team: team_string_array
    };
  })
  await browser.close();
  return unformatted_detail_obj;
}

// Function writes the scraped data into an Air Table row for the table 'Detailed Startup Table'
// Params: passed_id is the record id from 'Startup', passed_obj is a object with the cleaned string and string array of the scraped data
// Return: Promise that resolves into a record when the data is created
function writeDeatAT(passed_id, passed_obj){
  return detailsView.create({
    "Full Pitch": passed_obj.full_pitch,
    "Tags": passed_obj.tags,
    "Detailed Locations": passed_obj.locations,
    "Employees": passed_obj.num_emp,
    "Twitter": passed_obj.twitter,
    "Facebook": passed_obj.facebook,
    "Linkedin": passed_obj.linkedIn,
    "Source": [
      "AngelList"
    ],
    "Startup Basic": [
      passed_id
    ]
  });
}


// Function is a helper function for writeFoundersAT() that coverts a name into first and last name and creates a row for the founder in the 'Founders' table
// Params: passed_name is the full name of the founder as a string, startup_id is the record id from 'Startup', deat_id is the record id from the 'Detailed Startup Table'
// Return: Promise that resolves into a record when the data is created
function writeEachFounderAT(passed_name, startup_id, deat_id){
  let names = passed_name.split(' ');
  let fn = '';
  let ln = '';
  for(let i = 0;i<names.length;i++){
    if(i == 0){
      fn += names[i];
    }else if(i == 1){
      ln += names[i];
    }else{
      ln += ' ' + names[i];
    }
  }
  return foundersView.create({
    "Startup": [
      startup_id
    ],
    "First Name": fn,
    "Last Name": ln,
    "Angel Url": [
      deat_id
    ]
  });
}

// Function takes all the founders for a startup and calls helper functions via map to create rows for them in 'Detailed Startup Table'
// Params: startup_id is the record id from 'Startup', deat_id is the record id from the 'Detailed Startup Table', passed_obj is the clean scraped data
// Returns a Promise that resolves into an array of records when all the promises from calling writeEachFounderAT() resolve
async function writeFoundersAT(startup_id, deat_id, passed_obj){
  let waitingOn = await passed_obj.founders.map(founder_name => writeEachFounderAT(founder_name, startup_id, deat_id));
  return Promise.all(waitingOn);
}

// Function calls the helper functions to clean each data point that was scraped
// Param: the dirty scraped data as an object
// Returns the data points as a new clean object
function cleanObj(passed_obj){
  return {
    full_pitch: cleanPitch(passed_obj.d_full_pitch),
    num_emp: cleanNumEmp(passed_obj.d_num_emp),
    tags: cleanTags(passed_obj.d_tags),
    locations: cleanLocations(passed_obj.d_locations),
    twitter: cleanTwitter(passed_obj.d_twitter),
    facebook: cleanFacebook(passed_obj.d_facebook),
    linkedIn: cleanLinkedIn(passed_obj.d_linkedIn),
    founders: cleanFoundersArray(passed_obj.d_founders, passed_obj.d_team)
  };
}

function cleanPitch(str){
  return str;
}

function cleanNumEmp(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  return str;
}

// Function will clean the innerText string for tags for Air Table
// Param: the unclean tags string
// Return: returns the clean tags string
function cleanTags(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Replaces middle . with a comma
  let regex_dot = /\s.\s/g;
  str = str.replace(regex_dot, ',');
  return str;
}

// Function will clean the innerText string for locations for Air Table
// Param: the unclean locations string
// Return: returns the clean locations string
function cleanLocations(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Replaces middle . with a comma
  let regex_dot = /\s.\s/g;
  str = str.replace(regex_dot, ',');
  return str;
}

// Function will clean the href string for twitter link for Air Table
// Param: the unclean twitter link string
// Return: returns the clean twitter link string
function cleanTwitter(str){
  // Some hrefs are default back to the companies angel site - this removes those links
  let regex_angel_link = /http.?:\/\/angel\.co\/company\//g;
  if(regex_angel_link.test(str)){
    return '';
  }
  return str;
}

// Same as twitter comments
function cleanFacebook(str){
  // Some hrefs are default back to the companies angel site - this removes those links
  let regex_angel_link = /http.?:\/\/angel\.co\/company\//g;
  if(regex_angel_link.test(str)){
    return '';
  }
  return str;
}

// Same as twitter comments
function cleanLinkedIn(str){
  // Some hrefs are default back to the companies angel site - this removes those links
  let regex_angel_link = /http.?:\/\/angel\.co\/company\//g;
  if(regex_angel_link.test(str)){
    return '';
  }
  return str;
}

// Function will clean the founders names and choose the clean team names if there are no founders
// Params: f_arr is the array of dirty founder names from innerText, t_arr is the array of dirty team member names from innerText
// Return: Returns the foudner array if there are founders or the team array if not. The names in the return array are clean for Air Table
function cleanFoundersArray(f_arr, t_arr){
  if(f_arr.length > 0){
    return f_arr;
  }else{
    return t_arr;
  }
}

async function scrapeDeatPage_strange(passed_page){
  try{
    await console.log('Normal Page not found');
    await page.waitForSelector('#__next', {timeout:5000});
  }catch(err){
    await console.log('Abnormal Page not found');
    //await browser.close();
    return null;
  }
  await console.log('STRANGE PAGE FOUND');
  // Scrapes all the wanted data points on the page into an object
  unformatted_detail_obj = await page.evaluate(() => {
    // Also full pitch will be null when there is no pitch or when complex/custom html was created
    let full_pitch = '';
    if(document.querySelector('div[class^=\'productDescription\']') != null){
      full_pitch = document.querySelector('div[class^=\'productDescription\']').innerText;
    }

    // For num employees, the div will be found but be in a u-hidden class if there isnt a value
    // This if checks for ^
    let num_employees = '';
    /* Don't Have the selector yet
    if(document.querySelector('.js-company_size') != null){
      if(document.querySelector('.u-hidden > .js-company_size') == null){
        num_employees = document.querySelector('.js-company_size').innerText;
      }
    }
    */

    let all_tags = '';
    if(document.querySelector('dt a[class^=\'styles_component\']') != null){
      let all_tags_earray = document.querySelectorAll('dt a[class^=\'styles_component\']');
      for(let i =0;i<all_tags_earray.length - 1;i++){
        all_tags += all_tags_earray[i].innerText + ' . ';
      }
      all_tags += all_tags_earray[all_tags_earray.length -1].innerText;
    }
    // Selectors For twitter facebook linked in have not been updated <---------------
    let twitter = '';
    if(document.querySelector('.u-uncoloredLink.twitter_url') != null){
      twitter = document.querySelector('.u-uncoloredLink.twitter_url').href
    }

    let facebook = '';
    if(document.querySelector('.u-uncoloredLink.facebook_url') != null){
      facebook = document.querySelector('.u-uncoloredLink.facebook_url').href;
    }

    let linkedIn = '';
    if(document.querySelector('.u-uncoloredLink.linkedin_url') != null){
      linkedIn = document.querySelector('.u-uncoloredLink.linkedin_url').href;
    }

    //Checks for founders and if there are none checks for the team
    let founders_element_array = [];
    if(document.querySelectorAll('h4 a[class^=\'component\']').length != 0){
      founders_element_array = document.querySelectorAll('h4 a[class^=\'component\']');
    }
    // Takes the SelectAll query results for Founders and Teams members and places the names as text into an array
    let founders_string_array = [];
    for(let i = 0;i < founders_element_array.length; i++){
      founders_string_array.push(founders_element_array[i].innerText);
    }
    let team_string_array = [];
    return {
      d_full_pitch: full_pitch,
      d_num_emp: num_employees,
      d_tags: all_tags, d_twitter: twitter,
      d_facebook: facebook,
      d_linkedIn: linkedIn,
      d_founders: founders_string_array,
      d_team: team_string_array
    };
  })
  await browser.close();
  return unformatted_detail_obj;
}

main();
