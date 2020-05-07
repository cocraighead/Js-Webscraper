const puppeteer = require('puppeteer');
const Airtable = require('airtable');
const base = new Airtable({apiKey: 'key6Tigoyr6fyc4sK'}).base('appUi0FWGnwnFB3ve');
const view = base('Website Testing');


// Function will take the url of the startups website and attempt to go to the url.
// If the site returns a status code of 2xx the site body html is scraped and returned.
// If the site times out or returns an non 2xx status code then an empty string is returned. 
async function checkPage(passed_record){
    let return_html = '';
    let url = passed_record.get('url');
    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();
    let response = '';
    try{
        response = await page.goto(url);
    }catch(err){
        await console.log('CONNECTION TIMED OUT');
        await browser.close();
        return return_html;
    }
    let status = await response.status();
    await console.log(`Status: ${status}`);
    if(status>=200 && status<=299){
        await page.waitForSelector('body');
        return_html = await page.evaluate(() => {return document.querySelector('body').innerText});
        await browser.close();
        return return_html;
    }else{
        await browser.close();
        return return_html;
    }
}


// This function writes where the website is up or not up and the scraped html to AirTable
function writeDataAT(record, web_status, html){
  return view.update(record.getId(),{
    'Working website': web_status,
    'Scraped HTML': html
  });
}

// This function loops through the records in AirTable and check each website's status and grabs the html if the site is up
// It then writes that information back into AirTable
function main(){
  return view.select({
  }).eachPage(async function page(records, fetchNextPage) {
    for(let i=0;i<records.length;i++){
      if(records[i].get('Working website') == null){
        await console.log(`Checking ${records[i].get('Name')}`);
        let page_html = await checkPage(records[i]);
        let str_p = 'Not Waiting';
        if(page_html != ''){
            str_p = 'Up'
        }else{
            str_p = 'Not up'
        }
        await console.log(`Website is ${str_p}`);
        await writeDataAT(records[i],str_p,page_html);
      }
    }
    await fetchNextPage();
  });
}


main();



