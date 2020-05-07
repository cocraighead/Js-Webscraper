const puppeteer = require('puppeteer');
const csv = require('csv-parse');
const fs = require('fs');
const Airtable = require('airtable');
//const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const search_term_file = 'searchTerms.csv';
const base = new Airtable({apiKey: 'key6Tigoyr6fyc4sK'}).base('appUi0FWGnwnFB3ve');
const startupView = base('Startup');


// Function reads in csv file of urls for Angel List with preconfigured key words. After the scrape() function is called to lopp through the urls and scrape the table on the page.
// Param:
// Return:
function main(){
  const search_term_array = [];
  return fs.createReadStream(search_term_file)
    .pipe(csv())
    .on('data', (data) => search_term_array.push(data[Object.keys(data)]) )
    .on('end', () => {
      scrape(search_term_array);
    })
}

// Function will loop through urls and scrape each row in the loaded table on that page. It will call functions clean() and toAirTable() to clean the data and put it into Air Table
// Param: an array of urls to Angel list. Url should be preconfigred.
// Return:
async function scrape(st_array) {
  for(st_i in st_array){
    // Opens the page to scrape
    await console.log(`Searching: ${st_array[st_i]}`);
    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();
    // Blocks extra get requests
    await page.setRequestInterception(true);
    await page.on('request', (request) => {
      const req_url = request.url();
      const skip = [
          'driftt',
          'drift',
          'intercom',
          'segment'
      ];
      const should_skip = skip.some((url_part) => req_url.includes(url_part));
      if (should_skip || request.resourceType() === 'image' || request.resourceType() === 'stylesheet' || request.resourceType() === 'font'){
        request.abort();
      }else{
        request.continue();
      }
    });
    await page.goto('https://angel.co/companies');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    // Inputs the search term into the search bar and waits for the table to load
    await page.waitForSelector('.data_entry, [style="display: block;"]');
    await page.click('.input.keyword-input');
    // Adds the new line or return character to the search term so that it will proc the search
    let search_term_nl = st_array[st_i] + '\n';
    await page.type('.input.keyword-input', search_term_nl);
    await page.waitForNavigation({ waitUntil: 'networkidle0'}); // ------------ not gonna wait
    await page.waitFor(5000);
    // Finds the number of companies and calcs the number of times the more button needs to be clicked
    await page.waitForSelector('div.top > div.count');
    const companies_element = await page.$('.top > .count');
    const companies_text = await page.evaluate(companies_element => companies_element.textContent, companies_element);
    const count_obj = await countFunc(companies_text);
    const click_count = count_obj.num_clicks;
    const num_companies = count_obj.num_companies;
    // If the table is empty go to the next url
    if(num_companies == 0){
      await browser.close();
      continue;
    }
    // Clicks the joined columns header to order the rows by new and then waits for the table to load
    await page.waitForSelector('.column.joined.sortable');
    await page.click('.column.joined.sortable');
    await page.waitForNavigation({ waitUntil: 'networkidle0' }); // ------------ not gonna wait
    await page.waitFor(5000);
    // Declared arrays outside loop
    let dirty_obj_array;
    let clean_obj_array = [];
    // Loops through and opens the table to the full size - the last itteration is the actual scrape
    for(let i = 0;i <= click_count;i++) {
      if (i < click_count) {
        // If not the last page wait for the 'More' button and click it
        await page.waitForSelector(`div.results > div[data-page='${(i+2)}']`);
        await page.click('div.results > div.more');
      }else{
        // If the last page wait for the last nested '.results' div to load before beginning scraping
        await page.waitForSelector(nestedClassGenerator(i));
        dirty_obj_array = await page.evaluate(() => {
          let row_array = Array.from(document.querySelectorAll('div.base.startup'));
          let ret_array = [];
          for(let i in row_array){
            // Box with name link picture in first Column
            let textElement = row_array[i].querySelector('.g-lockup > .text');
            // Company name as text
            let name_text = textElement.querySelector('.startup-link').innerText;
            // Company link to Angel List page
            let angel_link_text = textElement.querySelector('.startup-link').href;
            // Company's pitch
            let pitch_text = textElement.querySelector('.pitch').innerText;
            // Location collumn - Location words that are a link

            let location_text = ''
            if(row_array[i].querySelector('.column.location > .value > .tag > a') != null){
              location_text = row_array[i].querySelector('.column.location > .value > .tag > a').innerText;
            }
            // Website column - Personal website link
            let personal_link_text = '';
            if(row_array[i].querySelector('.column.website > .value > .website > a') != null){
              personal_link_text = row_array[i].querySelector('.column.website > .value > .website > a').innerText;
            }
            // Stage column - div with description text
            let stage_text = row_array[i].querySelector('.column.stage > .value').innerText;
            // Total Raised column - div with $ amount rasied as text
            let total_raised_text = row_array[i].querySelector('.column.raised > .value').innerText;
            ret_array.push({
              name: name_text,
              angel_link: angel_link_text,
              pitch: pitch_text,
              location: location_text,
              personal_link: personal_link_text,
              stage: stage_text,
              total_raised: total_raised_text
             });
          }
          return ret_array;
        })
        for(let i in dirty_obj_array){
          let clean_obj = await clean(dirty_obj_array[i]);
          clean_obj_array.push(clean_obj);
        }
      }
    }
    await console.log(`Scraped ${clean_obj_array.length} startups`);
    await toAirTable(clean_obj_array);
    await browser.close();
  }
}

// Function takes the innerText for the number of companies and calculates the number of clicks needed to open the whole table
// Param: innerText for number of companies
// Return: number of times the more button can be clicked to open the whole table
function countFunc(companiesTextPassed){
  let regexCompanies = /[0-9]+/g;
  let regexArray = companiesTextPassed.match(regexCompanies);
  // loop combines the comma seperated sections of the number
  let combStr = '';
  for(let i in regexArray){
    combStr += regexArray[i];
  }
  let numCompanies = parseInt(combStr);
  let numClicks = Math.ceil((numCompanies-20)/20);
  numClicks = numClicks > 19 ? 19 : numClicks;
  console.log(`There are ${numCompanies} startups over ${numClicks+1} pages`);
  return {num_companies: numCompanies, num_clicks: numClicks};
}

// The nestedClassGenerator function just generates a dynamic string like '.content .results .results'. It adds an extra ' .results' for every "More" click as that creates a new nesting in the html.
// Param: i which is the value from the for loop
// Return: String with the apropriate number of .results for the table
function nestedClassGenerator(i) {
  let classStr = " .results";
  return ".content" + classStr.repeat(i+1);
}

// Function calls healper functions to clean each data point of the dirty obj
// Param: dirty_obj which is all the innerTexts and hrefs as an Object
// Return: same formated object as coming in but the strings are cleaned.
function clean(dirty_obj){
  return {
    name: cleanName(dirty_obj.name),
    angel_link: cleanAngelLink(dirty_obj.angel_link),
    pitch: cleanPitch(dirty_obj.pitch),
    location: cleanLocation(dirty_obj.location),
    personal_link: cleanPersonalLink(dirty_obj.personal_link),
    stage: cleanStage(dirty_obj.stage),
    total_raised: cleanTotalRaised(dirty_obj.total_raised)
  };
}

function cleanName(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Follwoing removes ',' and ';'
  str = str.replace(/,|;/g, '');
  return str;
}

function cleanAngelLink(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  return str;
}

function cleanPitch(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Remove '-' from data but not in links or names
  let regexDash = /-/g;
  str = str.replace(regexDash, '');
  if(str.length > 0){
    return '\"' + str + '\"';
  }
  return str;
}

function cleanLocation(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Remove '-' from data but not in links or names
  let regexDash = /-/g;
  str = str.replace(regexDash, '');
  // Follwoing Removes ',' and ';'
  str = str.replace(/,|;/g, '');
  return str;
}

function cleanPersonalLink(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Following cleans out personal links with spaces
  let regex_space = /\s/g;
  if(regex_space.test(str)){
    str  =  '';
  }
  // Following cleans out personal links with out the finisher i.e .com
  let regex_finisher = /\./g;
  if(!regex_finisher.test(str)){
    str  = '';
  }
  return str;
}

function cleanStage(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Remove '-' from data but not in links or names
  let regexDash = /-/g;
  str = str.replace(regexDash, '');
  return str;
}

function cleanTotalRaised(str){
  let regexReturn = /\n/g;
  str = str.replace(regexReturn, '');
  // Remove '-' from data but not in links or names
  let regexDash = /-/g;
  str = str.replace(regexDash, '');
  // Fowllowing section cleans a $ amount string into a number.
  let total_raised_temp = '';
  let regex_dollars = /[0-9]+/g;
  let regex_dollars_array = str.match(regex_dollars);
  // loop combines the comma seperated sections of the number
  for(let i in regex_dollars_array){
    total_raised_temp += regex_dollars_array[i];
  }
  str = total_raised_temp;
  return str;
}

// Function will call the function lookForATDups() for all the startups in the array and wait for each function call to finish before resolving the promise
// Param: An array of objects where each object has a startups data points
// Return: a single promise that resolves when the array of promises all resolve
async function toAirTable(passed_array){
  let wait_AT = await passed_array.map(obj => lookForATDups(obj));
  return await Promise.all(wait_AT);
}

// Function checks to see if the passed startup has a match in the air table. if there isn't any matches then writeRecords() is called
// Param: takes a single startup object
// Return: a promise that resolves once the select and potential write resolve
async function lookForATDups(passed_row){
    let comp = passed_row.angel_link;
    let matching_records = await startupView.select({
        filterByFormula: `{Angel Url}="${comp}"`
    }).firstPage();
    if(matching_records.length == 0){
      await writeRecord(passed_row);
    }
    return;
}

// Fucntion will write a new row into the 'Startup' table in air table with the scraped data of a startup.
// Param: an object which has the clean data points for a single startup
// Return: the promise from the table.create call
function writeRecord(passed_row){
    return startupView.create({
      "Name": passed_row.name,
      "Angel Url": passed_row.angel_link,
      "Pitch": passed_row.pitch,
      "Location": passed_row.location,
      "Personal Url": passed_row.personal_link,
      "Stage": passed_row.stage,
      "Total Raised": passed_row.total_raised
    }, {typecast: true} )
}

main();
