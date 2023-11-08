"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const cookie = require("cookie");
const fs = require("fs");
const moment = require("moment");
const OS = require("os");
const request = require("request");
const Debug = require("debug");
const url_parser = require("url");
const seo_1 = require("./seo");
const common_1 = require("./common");
const debug = Debug("bablic:seo");
const BABLIC_ROOT = "https://www.bablic.com";
function escapeRegex(str) {
    return str.replace(/([.?+^$[\]\\(){}|-])/g, "\\$1");
}
const Defaults = {
    siteId: null,
    rootUrl: null,
    locale: null,
    subDir: false,
    subDirBase: "",
    subDirOptional: false,
    onReady: null,
    seo: {
        useCache: true,
        defaultCache: [],
        test: false,
        cacheDir: OS.tmpdir() + "/bpCache",
    },
    folders: null,
};
const BackwardCompOptions = {
    siteId: ["site_id"],
    rootUrl: ["root_url"],
    subDir: ["subdir", "sub_dir"],
    subDirBase: ["subdir_base"],
    subDirOptional: ["subdir_optional"],
};
exports.BackwardCompSEOOptions = {
    useCache: ["use_cache"],
    defaultCache: ["default_cache"],
};
class BablicSDK {
    constructor(options) {
        this.meta = null;
        this.lastModified = null;
        this.preSnippet = "";
        this.snippet = "";
        this.snippetAsync = "";
        this.keywordsByLocale = null;
        this.reverseKeywordByLocale = null;
        this.handle = (req, res, next) => this.handler(req, res, next);
        let generalOptions = options;
        for (let key in BackwardCompOptions) {
            if (!options[key]) {
                BackwardCompOptions[key].forEach((alt) => {
                    if (generalOptions[alt]) {
                        generalOptions[key] = generalOptions[alt];
                    }
                });
            }
        }
        if (options.seo) {
            for (let key in exports.BackwardCompSEOOptions) {
                if (!options.seo[key]) {
                    exports.BackwardCompSEOOptions[key].forEach((alt) => {
                        if (generalOptions.seo[alt]) {
                            generalOptions.seo[key] = generalOptions.seo[alt];
                        }
                    });
                }
            }
        }
        if (!options.siteId) {
            throw new Error("Middleware requires and site_id");
        }
        this.options = _.defaultsDeep(options, Defaults);
        this.seoHandler = new seo_1.SeoMiddleware(this.options.siteId, this.options.seo, { subDir: this.options.subDir, subDirBase: this.options.subDirBase, subDirOptional: this.options.subDirOptional });
        this.seoMiddleware = this.seoHandler.middleware();
        if (this.options.meta) {
            this.meta = this.options.meta;
            this.processKeywords(this.options.keywords);
        }
        if (this.options.snippet) {
            this.snippet = this.snippetAsync = this.options.snippet;
        }
        this.lastModified = this.options.lastModified;
        if (this.meta && this.snippet) {
            if (this.options.onReady) {
                this.options.onReady();
            }
            return;
        }
        this.loadSiteMeta(() => {
            if (this.options.onReady) {
                this.options.onReady();
            }
        });
    }
    getSiteMeta(cbk) {
        debug("getting from bablic");
        request({
            method: "GET",
            url: `${BABLIC_ROOT}/api/v1/site/${this.options.siteId}?channel_id=node`,
        }, (error, response, body) => {
            if (error) {
                return cbk(error);
            }
            if (!body) {
                return cbk(new Error("empty response"));
            }
            try {
                let data;
                if (typeof (body) === "string") {
                    data = JSON.parse(body);
                }
                else {
                    data = body;
                }
                debug("data:", data);
                this.saveSiteMeta(data);
            }
            catch (e) {
                debug(e);
                return cbk(e);
            }
            cbk();
        });
    }
    saveSnippet(data, snippet) {
        let prefix = "";
        if (this.options.subDir) {
            let base = this.options.subDirBase ? `bablic.subDirBase="${this.options.subDirBase}";` : '';
            let opt = this.options.subDirOptional ? `bablic.subDirOptional=${!!this.options.subDirOptional};` : '';
            let folders = this.options.folders ? (`bablic.folders=${JSON.stringify(this.options.folders)};`) : '';
            prefix = `<script>var bablic=bablic||{};bablic.localeURL="subdir";${base}${opt}${folders}</script>`;
        }
        this.preSnippet = prefix;
        this.snippet = snippet;
        this.snippetAsync = (snippet || "").replace("<script", "<script async");
    }
    saveSiteMeta(data) {
        let { snippet, meta, lastModified } = data;
        this.saveSnippet(data, snippet);
        this.meta = meta;
        this.lastModified = lastModified;
        this.processKeywords(data.keywords);
        this.LOCALE_REGEX = null;
        data.id = this.options.siteId;
        fs.writeFile(this.snippetUrl(), JSON.stringify(data), (error) => {
            if (error) {
                console.error("Error saving snippet to cache", error);
            }
        });
    }
    snippetUrl() {
        return `${OS.tmpdir()}/snippet.${this.options.siteId}`;
    }
    getLocale(req) {
        if (req.headers["bablic-locale"] || req.headers["x-bablic-locale"]) {
            return (req.headers["bablic-locale"] || req.headers["x-bablic-locale"]);
        }
        let auto = this.meta.autoDetect;
        let defaultLocale = this.meta.default;
        let customUrls = this.meta.customUrls;
        let localeKeys = this.meta.localeKeys.slice();
        let getLocaleHandler = this.meta.getLocaleHandler;
        if (getLocaleHandler && typeof (getLocaleHandler) == "string")
            getLocaleHandler = this.meta.getLocaleHandler = eval(getLocaleHandler);
        localeKeys.push(this.meta.original);
        let localeDetection = this.meta.localeDetection;
        if (this.options.subDir) {
            localeDetection = "subdir";
        }
        return common_1.getLocaleByURL(url_parser.parse(getCurrentUrl(req)), localeDetection, customUrls, detectLocaleFromCookie(req, this.meta), defaultLocale, auto ? detectLocaleFromHeader(req) : "", false, this.options.locale, this.options.subDirBase, this.options.folders, localeKeys, getLocaleHandler);
    }
    getSiteMetaInner(cbk, retry = 0) {
        this.getSiteMeta((e) => {
            if (!e)
                return cbk(e);
            if (retry >= 10)
                return cbk(e);
            setTimeout(() => this.getSiteMetaInner(cbk, retry + 1), 5000);
        });
    }
    loadSiteMeta(cbk) {
        debug("loading meta from file");
        fs.readFile(this.snippetUrl(), (error, data) => {
            if (error) {
                debug("no local file, getting from server");
                return this.getSiteMetaInner(cbk);
            }
            debug("reading from temp file");
            try {
                let object = JSON.parse(data.toString("utf8"));
                if (object.id != this.options.siteId || object.error) {
                    debug("not of this site id");
                    return this.getSiteMetaInner(cbk);
                }
                this.meta = object.meta;
                this.saveSnippet(object, object.snippet);
                this.lastModified = object.lastModified;
                this.processKeywords(object.keywords);
            }
            catch (e) {
                debug(e);
                return this.getSiteMetaInner(cbk);
            }
            cbk();
            debug("checking snippet time");
            fs.stat(this.snippetUrl(), (e, stats) => {
                if (e) {
                    return cbk();
                }
                let last_modified = moment(stats.mtime.getTime());
                if (last_modified > moment().subtract(4, "hours")) {
                    return debug("snippet cache is good");
                }
                debug("refresh snippet");
                this.getSiteMetaInner(() => debug("refreshed snippet"));
            });
        });
    }
    handleBablicCallback(req, res) {
        this.getSiteMeta(() => debug("site snippet refreshed"));
        res.end("OK");
    }
    getLink(locale, url, fromLocale) {
        let parsed = url_parser.parse(url);
        return common_1.getLink(locale, parsed, this.meta, {
            subDir: this.options.subDir,
            subDirBase: this.options.subDirBase,
            subDirOptional: this.options.subDirOptional,
            folders: this.options.folders,
            returnFull: true,
        }, fromLocale) || url;
    }
    altTags(url, locale) {
        let locales = this.meta.localeKeys || [];
        let tags = _(locales)
            .concat([this.meta.original])
            .without(locale)
            .map((l) => `<link rel="alternate" href="${this.getLink(l, url, this.meta.original)}" hreflang="${l == this.meta.original ? "x-default" : l}">`)
            .valueOf();
        return tags.join("");
    }
    purgeCache() {
        if (!this.seoHandler)
            return Promise.resolve();
        return this.seoHandler.purgeCache();
    }
    purgeByUrl(url, locale) {
        if (!this.seoHandler)
            return Promise.resolve();
        return this.seoHandler.purgeByUrl(url, locale);
    }
    generateOriginalPath(url, locale) {
        let urlParts = url.split("?");
        let pathname = urlParts[0];
        let pathParts = pathname.split('.');
        let ext = pathParts.length > 1 ? '.' + pathParts[pathParts.length - 1] : '';
        let pathNoExt = pathParts.length > 1 ? pathParts.slice(0, pathParts.length - 1).join('.') : pathname;
        let reversed = this.reverseKeywordByLocale[locale];
        let original = pathNoExt.split("/").map((p) => reversed[p] || p).join("/");
        if (original != pathNoExt) {
            urlParts[0] = original + ext;
            return urlParts.join("?");
        }
        else {
            return null;
        }
    }
    generateTranslatedPath(url, locale) {
        let urlParts = url.split("?");
        let pathname = urlParts[0];
        let pathParts = pathname.split('.');
        let ext = pathParts.length > 1 ? '.' + pathParts[pathParts.length - 1] : '';
        let pathNoExt = pathParts.length > 1 ? pathParts.slice(0, pathParts.length - 1).join('.') : pathname;
        let proper = this.keywordsByLocale[locale];
        let translated = pathNoExt.split("/").map((p) => proper[p] || p).join("/");
        if (translated != pathNoExt) {
            urlParts[0] = translated + ext;
            return urlParts.join("?");
        }
        else {
            return null;
        }
    }
    handler(_req, _res, next) {
        const req = _req;
        const res = _res;
        if (!req.originalUrl) {
            req.originalUrl = req.url;
        }
        if ((req.originalUrl == "/_bablicCallback" && req.method == "POST") || req.headers["x-bablic-refresh"]) {
            debug("Redirecting to Bablic callback");
            return this.handleBablicCallback(req, res);
        }
        res.setHeader("x-bablic-id", this.options.siteId);
        if (!this.LOCALE_REGEX && this.options.subDir && this.meta && this.meta.localeKeys) {
            this.LOCALE_REGEX = RegExp("^(?:" + escapeRegex(this.options.subDirBase) + ")?\\/(" +
                common_1.createLocaleRegexChoices(this.meta.localeKeys, this.options.folders) + ")\\b");
        }
        if (!this.meta) {
            debug("not loaded yet", req.originalUrl);
            req.bablic = {
                locale: "",
            };
            extendResponseLocals(res, {
                bablic: {
                    locale: "",
                    snippet: "",
                    snippetBottom: "<!-- Bablic Footer OFF -->",
                    snippetTop: "<!-- Bablic Head OFF -->",
                },
            });
            return next();
        }
        let locale = req.forceLocale || this.options.forceLocale || this.getLocale(req);
        req.bablic = {
            locale,
            proxied: false,
        };
        if (this.options.subDir && this.LOCALE_REGEX) {
            req.url = req.url.replace(this.LOCALE_REGEX, "");
            req.originalUrl = req.originalUrl.replace(this.LOCALE_REGEX, "");
        }
        if (this.reverseKeywordByLocale && this.reverseKeywordByLocale[locale]) {
            let original = this.generateOriginalPath(req.url, locale);
            // build original URL, so server will return proper content
            if (original) {
                req.url = original;
                req.originalUrl = this.generateOriginalPath(req.originalUrl, locale) || req.originalUrl;
            }
            else if (req.method == "GET") {
                // check to see if there is a translated URL, if so, it should be redirected to it
                let translated = this.generateTranslatedPath(req.originalUrl, locale);
                if (translated) {
                    res.writeHead(301, { location: translated });
                    return res.end();
                }
            }
        }
        if (this.meta.rewriteUrlHandler) {
            let original = this.getLink(this.meta.original, req.url, locale);
            // build original URL, so server will return proper content
            if (original && original !== req.url) {
                req.url = original;
                req.originalUrl = this.getLink(this.meta.original, req.originalUrl, locale) || req.originalUrl;
            }
            else if (req.method == "GET") {
                // check to see if there is a translated URL, if so, it should be redirected to it
                let translated = this.getLink(locale, req.url, this.meta.original);
                if (translated && translated !== req.url) {
                    res.writeHead(301, { location: translated });
                    return res.end();
                }
            }
        }
        let fullUrl = req.originalUrl;
        if (this.options.rootUrl) {
            const rootParsed = url_parser.parse(this.options.rootUrl);
            fullUrl = rootParsed.protocol + '//' + rootParsed.hostname + req.originalUrl;
        }
        const localObj = {
            locale,
            snippet: this.preSnippet + (this.meta.original == locale ? this.snippetAsync : this.snippet),
            snippetBottom: "",
        };
        Object.defineProperty(localObj, "snippetTop", {
            get: () => "<!-- start Bablic Head -->" + this.altTags(fullUrl, locale) + this.preSnippet + (this.meta.original == locale ? this.snippetAsync : this.snippet) + "<!-- start Bablic Head -->",
        });
        extendResponseLocals(res, {
            bablic: localObj,
        });
        if (!this.seoMiddleware) {
            return next();
        }
        if (locale == this.meta.original) {
            debug("ignored same language", req.url);
            return next();
        }
        return this.seoMiddleware(this.meta, this.lastModified, this.keywordsByLocale, this.reverseKeywordByLocale, req, res, next);
    }
    processKeywords(keywords) {
        if (!keywords) {
            return;
        }
        this.keywordsByLocale = {};
        this.reverseKeywordByLocale = {};
        this.meta.localeKeys.forEach((locale) => {
            let proper = {};
            let reverse = {};
            for (let keyword in keywords) {
                if (!keywords[keyword][locale]) {
                    continue;
                }
                proper[keyword] = keywords[keyword][locale];
                reverse[keywords[keyword][locale]] = keyword;
            }
            this.keywordsByLocale[locale] = proper;
            this.reverseKeywordByLocale[locale] = reverse;
        });
    }
}
exports.BablicSDK = BablicSDK;
function extendResponseLocals(res, context) {
    if (typeof (res.locals) == "function") {
        res.locals(context);
    }
    else if (res.locals) {
        _.extend(res.locals, context);
    }
    else {
        res.locals = context;
    }
}
function detectLocaleFromHeader(req) {
    let header = req.headers["accept-language"];
    if (!header) {
        return "";
    }
    let langs = header.split(",");
    if (langs.length > 0) {
        return langs[0].replace("-", "_");
    }
    return "";
}
function detectLocaleFromCookie(req, meta) {
    let cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return "";
    }
    if (!meta.localeKeys) {
        return "";
    }
    let cookies = req.cookies || cookie.parse(cookieHeader);
    if (!cookies) {
        return "";
    }
    let bablicCookie = cookies.bab_locale;
    if (!bablicCookie) {
        return "";
    }
    let index = meta.localeKeys.indexOf(bablicCookie);
    if (index > -1) {
        return bablicCookie;
    }
    let partialFound = _.find(meta.localeKeys, (l) => l[0] == bablicCookie[0] && l[1] == bablicCookie[1]);
    return partialFound || "";
}
function getCurrentUrl(req) {
    return `http://${req.headers.host}${req.originalUrl}`;
}
