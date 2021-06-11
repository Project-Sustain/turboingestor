import fs = require('fs');
import { randomString } from './util'
import csv = require('csv-parser');
import readline = require('readline');

const ingestNeon = async (name: string, filepath: string) => {
    let files = fs.readdirSync(filepath);

    const findFileMatch = (regexp: RegExp) => {
        for (const file of files) {
            if (file.match(regexp)) {
                return file;
            }
        }
    }

    const manifestFp = findFileMatch(/^.*\.manifest\..*\.json$/g);
    console.log(`Neon manifest is ${manifestFp}`)
    const manifest = JSON.parse(fs.readFileSync(`${filepath}/${manifestFp}`, 'utf8'));
    const { siteCodes, productCode, productName, releases } = manifest;
    console.log(`Sitecodes are: ${siteCodes}`)
    const uniqueRun = randomString(4);
    console.log(`Unique code for this run is ${uniqueRun}`)

    const timeSeriesFileName = `${name}_time_series_${uniqueRun}.csv`
    console.log(`Creating Time Series: ${timeSeriesFileName}`)
    fs.appendFileSync(`./out/${timeSeriesFileName}`, 'SITE,epoch_time');

    const labelMapFileName = `${name}_label_map_${uniqueRun}.json`
    console.log(`Creating Label map: ${labelMapFileName}`)
    fs.openSync(`./out/${labelMapFileName}`, 'w');

    const locationsFileName = `${name}_locations_${uniqueRun}.csv`
    console.log(`Creating Locations: ${locationsFileName}`)
    fs.appendFileSync(`./out/${locationsFileName}`, 'SITE,PRODUCT,LAT,LONG\n');

    let timeSeriesHeaderIsDone = false;
    for (const siteCode of siteCodes) {
        let relevantPackages = [];
        for (const release of releases) {
            for (const releasePackage of release.packages) {
                if (releasePackage.siteCode === siteCode) {
                    relevantPackages.push(releasePackage);
                }
            }
        }
        relevantPackages = relevantPackages.sort((a, b) => new Date(a.month).valueOf() - new Date(b.month).valueOf());

        let hasLocationForSiteCode = false;
        for (const relevantPackage of relevantPackages) {
            const { domainCode, month } = relevantPackage;
            const folder = findFileMatch(new RegExp(`^NEON\.${domainCode}\.${siteCode}\.${productCode}\.${month}\..*$`));
            console.log(`Package folder is ${folder}`)


            if (!hasLocationForSiteCode) {
                console.log(`Getting sensor pos for ${siteCode}`)
                for (const file of relevantPackage.files) {
                    if (file.fileName.match(/^.*sensor_positions.*.csv$/g)) {
                        console.log(`File with positions is: ${file.fileName}`)
                        const { referenceLatitude, referenceLongitude } = await new Promise(resolve => {
                            const posStream = fs.createReadStream(`${filepath}/${folder}/${file.fileName}`)
                                .pipe(csv())
                                .on('data', (data) => { posStream.destroy(); resolve(data); })
                        });
                        fs.appendFileSync(`./out/${locationsFileName}`, `${siteCode},${name},${Number(referenceLatitude)},${Number(referenceLongitude)}\n`);
                        break;
                    }
                }
                hasLocationForSiteCode = true;
            }

            const tsRegex = /^.*BP_30min.*$/g
            let tsFile: string = "";
            for (const file of relevantPackage.files) {
                if (file.fileName.match(tsRegex)) {
                    tsFile = file.fileName;
                    console.log(`Time series file is ${tsFile}`)
                    break;
                }
            }

            if (!timeSeriesHeaderIsDone) {
                console.log(`Adding time series header to out!`)
                const fileStream = fs.createReadStream(`${filepath}/${folder}/${tsFile}`);
                const rl = readline.createInterface({
                    input: fileStream,
                    crlfDelay: Infinity
                });
                for await (const line of rl) {
                    fs.appendFileSync(`./out/${timeSeriesFileName}`, `${line}\n`);
                    break;
                }
                timeSeriesHeaderIsDone = true;
            }

            console.log(`Collection epoch times from ${folder}`)
            let times: number[] = [];
            await new Promise<void>(resolve => {
                fs.createReadStream(`${filepath}/${folder}/${tsFile}`)
                .pipe(csv())
                .on('data', (data) => { times.push(new Date(data.startDateTime).valueOf()) })
                .on('end', () => { resolve() })
            });

            console.log(`Pasting time series for ${folder}`)
            const fileStream = fs.createReadStream(`${filepath}/${folder}/${tsFile}`);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });
            let index = 0;
            for await (const line of rl) {
                if(index !== 0){
                    fs.appendFileSync(`./out/${timeSeriesFileName}`, `${siteCode},${times.shift()},${line}\n`);
                }
                index++;
            }

            break;
        }
        break;
    }
}

export default ingestNeon;