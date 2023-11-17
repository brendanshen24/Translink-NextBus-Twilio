const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cheerio = require('cheerio')

const app = express();
app.use(bodyParser.urlencoded({extended: false}));

const sign_flip = (delay) => {
    if(delay != ''){
        const int_delay = parseInt(delay);
        return (int_delay*(-1)).toString()
    }
    else{
        return '0'
    }
}

const delay_handler = (delay_str) => {
    if (delay_str == ''){
        return 0
    }
    else {
        return parseInt(delay_str);
    }
}

const convert_time = (time) => {
    const split_time = time.split(':');
    if (parseInt(split_time[0]) > 12 && parseInt(split_time[0]) <= 24){
        const new_time = parseInt(split_time[0])-12;
        const new_string = new_time.toString()+':'+split_time[1]+' PM'
        return new_string;
    }
    else{
        if(parseInt(split_time[0]) > 24){
            const new_time = parseInt(split_time[0])-24;
            const new_string = new_time.toString()+':'+split_time[1]
            return convert_time(new_string);
        }
        else {
            return time + ' AM';
        }
    }
}

const has_AC = (model) => {
    const buses = {
        "Alexander Dennis Enviro500": true,
        "Chevrolet 4500/Girardin G5": false,
        "Chevrolet 4500/ARBOC SOF 27": true,
        "Chevrolet 4500/ARBOC SOM 28": true,
        "New Flyer D40LF": false,
        "New Flyer D40LFR": false,
        "New Flyer D60LFR": false,
        "New Flyer DE60LFR": false,
        "New Flyer E40LFR": false,
        "New Flyer E60LFR": false,
        "New Flyer XD40": true,
        "New Flyer XDE60": true,
        "New Flyer XN40": true,
        "Nova Bus LFS": false,
        "Nova Bus LFS HEV": false,
        "Nova Bus LFS Suburban": true,
    };
    if(model === undefined){
        return 'undefined model';
    }
    const split_model = model.split(' ');
    if (parseInt(split_model[0]) >= 2012){
        return 1;
    }
    else{
        /*        split_model.shift();
                const new_string = split_model.join(' ');

                if(buses[new_string] == true){
                    return 'Yes!'
                }
                else{
                    return 'No!'
                }*/
        return 0;
    }
}

app.post('/sms', function(req, responseText) {
    //console.log(req.body);
    let stopID = req.body.Body.trim().split(' ')[0];

    const baseUrl = 'http://compat.sorrybusfull.com'; // Base URL
    const homepagePath = ('/stoprt/'+stopID.toString()); // Homepage path

    const getDataFromMainPage = async () => {
        try {
            const response = await axios.get(`${baseUrl}${homepagePath}`);
            if (response.status === 200) {
                const mainPageHtml = response.data;
                const mainPage$ = cheerio.load(mainPageHtml);

                // Extract title
                const title = mainPage$('head title').text().trim();

                // Extract realtime status
                const realtime = mainPage$('#realtime').text().trim();

                // Extract schedule data
                const scheduleData = [];
                const vehicleRequests = [];

                mainPage$('div.block #stop table tr').each((index, element) => {
                    const columns = mainPage$(element).find('td');
                    const rowData = {};

                    columns.each((i, col) => {
                        const columnName = ['Trip', 'Sched', 'Corr', 'Delay', 'Wait', 'Block', 'Vehicle'][i];
                        rowData[columnName.toLowerCase()] = mainPage$(col).text().trim();
                    });

                    // Add vehicle number
                    const vehicleLink = mainPage$(element).find('td a[href^="/vehicle/"]');
                    if (vehicleLink.length > 0) {
                        const vehiclePageUrl = `${baseUrl}${vehicleLink.attr('href')}`;
                        const vehicleRequest = axios.get(vehiclePageUrl).then(vehiclePageResponse => {
                            const vehiclePageHtml = vehiclePageResponse.data;
                            const vehiclePage$ = cheerio.load(vehiclePageHtml);
                            const model = vehiclePage$('th:contains("Model")').next('td').text().trim();
                            rowData['model'] = model;
                        });

                        vehicleRequests.push(vehicleRequest);
                    }

                    // Push the row data to the main data array
                    scheduleData.push(rowData);
                });

                // Wait for all vehicle information requests to complete
                await Promise.all(vehicleRequests);

                // Organize data into an object
                const mainPageData = {
                    title,
                    realtime,
                    scheduleData,
                };

                let buses_at_this_stop = []
                let to_list = []
                for (let i = 1; i < mainPageData.scheduleData.length; i++) {
                    if(buses_at_this_stop.includes(mainPageData.scheduleData[i].trip) == false){
                        buses_at_this_stop.push(mainPageData.scheduleData[i].trip)
                        to_list.push(mainPageData.scheduleData[i])
                    }
                }
                //console.log(to_list)
                let formatted_message;
                if(to_list.length == 1){
                    const scheduled_for = convert_time(to_list[0].sched);
                    const delay = sign_flip(to_list[0].delay);
                    let adjust_time = to_list[0].corr
                    if (adjust_time ===''){
                        adjust_time = scheduled_for;
                    }
                    else{
                        adjust_time = convert_time(adjust_time)
                    }
                    let delaymsg;
                    if(delay < 0){
                        delaymsg = 'Early by: ' + (delay*-1).toString() + ' min'
                    }
                    else{
                        delaymsg = 'Delayed by: ' + delay.toString() + ' min'
                    }
                    let wait_time = to_list[0].wait;
                    if(wait_time === ''){
                        wait_time = '>90 min'
                    }

                    let ACstatus;
                    let vehicle = to_list[0].model;
                    if (vehicle === undefined){
                        vehicle = 'Not yet known.'
                        ACstatus = 'Not yet known.'
                    }
                    else{
                        const ACbool = has_AC(vehicle);
                        if (ACbool == true){
                            ACstatus = 'Yes.'
                        }
                        else{
                            ACstatus = 'No.'
                        }
                    }
                    formatted_message = `\n\nThe next departing bus for ${mainPageData.title} is for:\n${to_list[0].trip}.\n\nDetails:\nScheduled for: ${scheduled_for}\n${delaymsg}\nAdjusted arrival time: ${adjust_time}\nWait: ${wait_time}\nVehicle: ${vehicle}\nDoes this bus have AC? ${ACstatus}`;
                }

                else{
                    formatted_message = `\n\nThe next departing buses for ${mainPageData.title} are for:`;
                    for (let i = 0; i < to_list.length; i++) {
                        const scheduled_for = convert_time(to_list[i].sched);
                        const delay = delay_handler(to_list[i].delay);
                        let adjust_time = to_list[i].corr
                        if (adjust_time ===''){
                            adjust_time = scheduled_for;
                        }
                        else{
                            adjust_time = convert_time(adjust_time)
                        }

                        let delaymsg;
                        if(delay < 0){
                            delaymsg = 'Early by: ' + (delay*-1).toString() + ' min'
                        }
                        else{
                            delaymsg = 'Delayed by: ' + delay.toString() + ' min'
                        }

                        let wait_time = to_list[i].wait;
                        if(wait_time === ''){
                            wait_time = '>90 min'
                        }
                        let ACstatus;
                        let vehicle = to_list[i].model;
                        if (vehicle === undefined){
                            vehicle = 'Not yet known.'
                            ACstatus = 'Not yet known.'
                        }
                        else{
                            const ACbool = has_AC(vehicle);
                            if (ACbool == true){
                                ACstatus = 'Yes.'
                            }
                            else{
                                ACstatus = 'No.'
                            }
                        }
                        formatted_message += `\n\n${to_list[i].trip}.\n\nDetails:\nScheduled for: ${scheduled_for}\n${delaymsg}\nAdjusted arrival time: ${adjust_time}\nWait: ${wait_time}\nVehicle: ${vehicle}\nDoes this bus have AC? ${ACstatus}`;
                    }
                }
                //console.log(formatted_message)
                responseText.send('<Response><Message>' + formatted_message + '</Message></Response>');
            }
        } catch (error) {
            console.error('Error fetching the main page:', error);
            const errorMsg = 'That stop does not exist!'
            responseText.send('<Response><Message>' + errorMsg + '</Message></Response>');
        }
    };

// Call the function to get data from the main page
    getDataFromMainPage();

    //responseText.send('<Response><Message>' + req.body.Body + '</Message></Response>');
});

app.get('/reg', function (req, responseText) {
    // Serve the "hello.html" file when a GET request is received at /reg
    fs.readFile('hello.html', 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading "hello.html":', err);
            responseText.status(500).send('Internal Server Error');
        } else {
            responseText.send(data);
        }
    });
});

var listener = app.listen(process.env.PORT, function () {
    console.log('Your app is listening on port ' + listener.address().port);
});


