import { expect } from 'chai';


process.env.DEBUG = '*';
import * as http from 'http';
import * as request from 'request';
import * as bablic from '../index';
import {ExtendedRequest, ExtendedResponse} from "../lib/common";


describe('Hello', function() {

    before("Load Server with Bablic",done => {
        const onReady = ():void => {
            console.log('Bablic ready');

            http.createServer((req, res) => {
                bablicMiddleware(req, res, () => {
                    let extendedReq = <ExtendedRequest>req;
                    let extendedRes = <ExtendedResponse>res;

                    res.setHeader('Content-Type', 'text/html');
                    res.setHeader('X-Locale', extendedReq.bablic.locale);
                    let path = req.url.split('?')[0];
                    if(path == '/about') {
                        res.end(`
        <html>
        <body>
        <h1>About us</h1>
        </body>
        </html>`);

                    }
                    else if(path == '/') {
                        res.end(`
        <html>
        <head>${extendedRes.locals.bablic.snippet}</head>
        <body>
        <h1>made by</h1>
        <p>LOADING...</p>
        </body>
        </html>`);
                    }
                    else {
                        res.writeHead(404);
                        res.end();
                    }
                });

            }).listen(1432, () => done());
        };

        console.log('init bablic');
        let bablicMiddleware = bablic.create({
            siteId:'5af975a0d747572ef39eb049',
            onReady:onReady,
            seo:{
                useCache:false
            },
            meta:{
                timestamp: 0,
                original: 'en',
                default: 'en',
                autoDetect: true,
                localeKeys: [ 'es' ],
                localeDetection: 'querystring',
                includeQueryString: false,
                includeHash: false,
                singlePageApp: false,
                customUrls: null,
                qsParams: [],
                domain: 'eelslap.com/',
                mountSubs: []
            },
            snippet:`<script data-cfasync="false" type="text/javascript" data-bablic="5af975a0d747572ef39eb049" data-bablic-m="[0,'en','en',1,['es'],0,0,0,0,0,0,0,0,[],'eelslap.com/',[],['_v',2]]" src="//cdn2.bablic.com/js/bablic.3.9.js"></script>`,
            keywords:{
                about:{es:'sobre' }
            }
        });
    });
    it('should return translated HTML', function(done) {

        request({
            method:'GET',
            url:'http://localhost:1432/?locale=es',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
            }
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();

            expect(response.statusCode).equal(200);
            expect(body).include('CARGANDO...');
            expect(body).include('hecho por');
            done();
        });
    });

    it("should not translate without user agent", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/?locale=es',
            headers:{
                host:'eelslapnot.com',
                'user-agent':'Mozilla/5.0'
            }
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();

            expect(response.statusCode).equal(200);
            expect(body).include('LOADING...');
            expect(body).include('made by');
            done();
        });
    });

    it("should return header with spanish", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/?locale=es',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            }
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();

            expect(response.headers['x-locale']).equal('es');
            done();
        });
    });

    it("should return header with english", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/?locale=en',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            }
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();

            expect(response.headers['x-locale']).equal('en');
            done();
        });
    });

    it("should write in snippet", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/?locale=en',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            }
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();
            expect(body).include('cdn2.bablic.com/js/bablic');
            done();
        });
    });

    it("should redirect old URLs", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/about?locale=es',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            },
            followRedirect:false
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();
            expect(response.statusCode).equal(301);
            expect(response.headers['location']).equal('/sobre?locale=es');
            done();
        });
    });

    it("should should return 404 on spanish page without locale", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/sobre?locale=en',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            },
            followRedirect:false
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();
            expect(response.statusCode).equal(404);
            done();
        });
    });

    it("should should return 200 on spanish page with locale", done => {

        request({
            method:'GET',
            url:'http://localhost:1432/sobre?locale=es',
            headers:{
                host:'eelslap.com',
                'user-agent':'Mozilla/5.0'
            },
            followRedirect:false
        },(e, response, body) => {
            expect(e).null;
            if(e)
                return done();
            expect(response.statusCode).equal(200);
            expect(body).include('About us');
            done();
        });
    });

});
