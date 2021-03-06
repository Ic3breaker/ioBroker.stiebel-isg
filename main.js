/**
 *
 * stiebel-eltron/tecalor isg adapter
 *
 */

'use strict';

const utils = require(__dirname + '/lib/utils');
const adapter = new utils.Adapter('stiebel-isg');
const querystring = require("querystring");
let systemLanguage;
let nameTranslation;
let isgIntervall;
let isgCommandIntervall;
var jar;
let host;
const commandPaths = ["/?s=4,0,2","/?s=4,0,3","/?s=4,0,4","/?s=4,0,5","/?s=4,1,0","/?s=4,2,0","/?s=4,2,1","/?s=4,2,2","/?s=4,2,6"];
//"/?s=4,1,1","/?s=4,2,3","/?s=4,2,4","/?s=4,2,5","/?s=4,2,7" //other syntax required, WIP
const valuePaths = ["/?s=1,0","/?s=1,1"];

const request = require('request');
const cheerio = require('cheerio');

adapter.on('ready', function () {    
    adapter.getForeignObject('system.config', function (err, obj) {
        if (err) {
            adapter.log.error(err);
            return;
        } else if (obj) {
            if (!obj.common.language) {
                adapter.log.info("Language not set. English set therefore.");
                nameTranslation = require(__dirname + '/admin/i18n/de/translations.json')
            } else {
                systemLanguage = obj.common.language;
                nameTranslation = require(__dirname + '/admin/i18n/' + systemLanguage + '/translations.json')
            }

            setJar(request.jar());
            main();
        }
    });
});

adapter.on('unload', function (callback) {
    try {
        if (isgIntervall) clearInterval(isgIntervall);
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('stateChange', function (id, state) {
    let command = id.split('.').pop();
    
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (!state || state.ack) return;
    setIsgCommands(command,state.val);
});

function setJar(jarParam) {
    jar = jarParam;
}

function getJar() {
    if(jar)
        return jar;
    else {
        jar = request.jar();
        return jar;
    }
}

function translateName(strName, intType) {
    if (typeof intType === 'undefined') { intType = 0; }
    
    switch (intType) {
        case 1:
            if(nameTranslation[strName]) {
                return nameTranslation[strName][1];
            } else {
                return strName;
            }
            break;
        case 0:
        default:
            if(nameTranslation[strName]) {
                return nameTranslation[strName][0];
            } else {
                return strName;
            }
            break;
    }
}

function updateState (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue) {
    adapter.log.debug("strGroup: "+strGroup);
    adapter.setObjectNotExists(
        strGroup + "." + valTag, {
            type: 'state',
            common: {
                name: valTagLang,
                type: valType,
                read: true,
                write: false,
                unit: valUnit,
                role: valRole
            },
            native: {}
        },
        adapter.setState(
            strGroup + "." + valTag,
            {val: valValue, ack: true, expire: (adapter.config.isgIntervall*2)} //value expires if adapter can't pull it from hardware
        )
    );
}

function getIsgValues(sidePath) {
    let strURL = host + sidePath;
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword
    });
    
    const options = {
        method: 'POST',
        body: payload,
        uri: strURL,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Connection': 'keep-alive'
        }
    };
    
    request(options, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            let $ = cheerio.load(content);
            
            let submenu = $('#sub_nav')
                .children()
                .first()
                .text()
                .replace(/[\-\/]+/g,"_")
                .replace(/[ \.]+/g,"")
                .replace(/[\u00df]+/g,"SS");

            $('.info').each((i, el) => {                
                let group = $(el)
                    .find(".round-top")    
                    .text()
                    .replace(/[ \-]+/g,"_")
                    .replace(/[\.]+/g,"")
                    .replace(/[\u00df]+/,"SS");
                
                group = submenu + "." + group
                
                $(el).find('tr').each(function() {
                    let valueName = $(this)
                        .find(".key")
                        .text();
                    
                    let key = $(this)
                        .find(".key")
                        .text()
                        .replace(/[ \-]+/g,"_")
                        .replace(/[\.]+/g,"")
                        .replace(/[\u00df]+/,"SS");
                    
                    let param = $(this)
                        .find(".value")
                        .text()
                        .replace(/\,/,".");
                    
                    let value = parseFloat(param);
                    let unit = param
                        .replace(/[ ]{0,2}/, "")
                        .replace(value, "")
                        .replace(/([\.0][0]){1}?/, "");
                    
                    
                    let valType = typeof value;
                    let valueRole;
                    
                    if (key.search('TEMP') > -1 || key.search('SOLLWERT_HK') == 0 || key.search('ISTWERT_HK') == 0){
                        valueRole = 'value.temperature';
                    } else if (key.search('DRUCK') > -1){
                        valueRole = 'value.pressure';
                    } else if (key.search('P_') == 0){
                        valueRole = 'value.power.consumption';
                    } else if (key.search('FEUCHTE') > -1){
                        valueRole = 'value.humidity';
                    } else {
                        valueRole = 'value';
                    }
                    
                    if(key){
                        updateState (translateName("info") + "." + group,key,translateName(valueName),valType,unit,valueRole,value);
                    }
                }); 
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function createISGCommands (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue,valStates,valMin,valMax) {
    adapter.log.debug("strGroup: "+strGroup);
    adapter.setObjectNotExists(
        strGroup + "." + valTag, {
            type: 'state',
            common: {
                name: valTagLang,
                type: valType,
                read: true,
                write: true,
                unit: valUnit,
                role: valRole,
                min: valMin,
                max: valMax,
                states: valStates
            },
            native: {}
        },
        adapter.setState(
            strGroup + "." + valTag,
            {val: valValue, ack: true}
        )
    );
}

function getIsgCommands(sidePath) {
    let strURL = host + sidePath;
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword
    });
    
    const options = {
        method: 'POST',
        body: payload,
        uri: strURL,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Connection': 'keep-alive'
        }
    };
    
    request(options, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            let $ = cheerio.load(content);
            
            let group = $('#sub_nav')
                .children()
                .first()
                .text()
                .replace(/[\-\/]+/g,"_")
                .replace(/[ \.]+/g,"")
                .replace(/[\u00df]+/g,"SS");

            let submenu = $.html().match(/#subnavactivename"\).html\('(.*?)'/);
            
            //Get values from script, because JavaScript isn't running with cheerio.
            $('#werte').find("input").each(function(i, el) { 
                let scriptValues = $(this)
                    .next()
                    .get()[0]
                    .children[0]
                    .data;

                let nameCommand = $(this).parent().parent().find('h3').text();
                let minCommand = scriptValues.match(/\['min'] = '(.*?)'/);
                let maxCommand = scriptValues.match(/\['max'] = '(.*?)'/);
                let valCommand = scriptValues.match(/\['val']='(.*?)'/);
                let idCommand = scriptValues.match(/\['id']='(.*?)'/);

                if(maxCommand){
                    createISGCommands(translateName("settings") + "." + group + "." + submenu[1], idCommand[1], nameCommand, "number","","state",valCommand[1],"",minCommand[1],maxCommand[1]);
                }
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function setIsgCommands(strKey, strValue) {    
    const commands = JSON.stringify(
        [{'name': strKey,
          'value': strValue}]
    )
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword,
        data: commands
    });

    const postOptions = {
        method: 'POST',
        uri: host + "/save.php",
        port: '80',
        body: payload,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': '*/*'
        }
    };

    request(postOptions, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            commandPaths.forEach(function(item){
                getIsgCommands(item);
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function main() {
    host = adapter.config.isgAddress;
    if(host.search(/http/i) == -1){
        host = "http://" + host;
    }
    adapter.subscribeStates('*')
    
    valuePaths.forEach(function(item){
        getIsgValues(item);
    })

    commandPaths.forEach(function(item){
        getIsgCommands(item);
    })

    isgIntervall = setInterval(function(){
            valuePaths.forEach(function(item){
                getIsgValues(item);
            })
        }, (adapter.config.isgIntervall * 1000));

    isgCommandIntervall = setInterval(function(){
            commandPaths.forEach(function(item){
                getIsgCommands(item);
            })
        }, (adapter.config.isgCommandIntervall * 1000));

    createISGCommands('Einstellungen','val39s','Betriebsart','number','','level','11','{"11":"AUTOMATIK", "1":"BEREITSCHAFT", "3":"TAGBETRIEB", "4":"ABSENKBETRIEB","5":"WARMWASSER", "14":"HANDBETRIEB", "0":"NOTBETRIEB"}');
}
