import * as _ from "lodash";
import * as cookie from "cookie";
import * as fs from "fs";
import * as moment from "moment";
import * as OS from "os";
import * as request from "request";
import * as Debug from "debug";
import * as url_parser from "url";

import {SeoMiddleware, SeoOptions} from "./seo";
import {ExtendedRequest, ExtendedResponse, getLocaleByURL, getLink, SiteMeta, KeywordMapper} from "./common";

const debug = Debug("bablic:seo");

const BABLIC_ROOT = "https://www.bablic.com";

function escapeRegex(str: string): string {
    return str.replace(/([.?+^$[\]\\(){}|-])/g, "\\$1");
}

export interface BablicOptions {
    siteId: string;
    rootUrl?: string;
    locale?: string;
    subDir?: boolean;
    subDirBase?: string;
    subDirOptional?: boolean;
    onReady?: () => void;
    seo?: SeoOptions;
    folders?: {
        [locale: string]: string,
    };
    meta?: SiteMeta;
    snippet?: string;
    keywords?: {
        [urlKeyword: string]: {
            [locale: string]: string,
        },
    };
}

export interface SiteData {
    id?: string;
    error?: string;
    snippet: string;
    meta: SiteMeta;
    keywords?: {
        [urlKeyword: string]: {
            [locale: string]: string,
        },
    };
}

const Defaults: BablicOptions = {
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
export const BackwardCompSEOOptions = {
    useCache: ["use_cache"],
    defaultCache: ["default_cache"],
};

export class BablicMiddleware {
    public meta: SiteMeta = null;
    public snippet = "";
    private options: BablicOptions;
    private LOCALE_REGEX: RegExp;
    private seoMiddleware: (meta: SiteMeta, keywordsByLocale: KeywordMapper, reverseKeywordByLocale: KeywordMapper, req: ExtendedRequest, res: ExtendedResponse, next: () => void) => void;

    private keywordsByLocale: KeywordMapper = null;
    private reverseKeywordByLocale: KeywordMapper = null;
    constructor(options: BablicOptions) {
        let generalOptions = options as any;
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
            for (let key in BackwardCompSEOOptions) {
                if (!options.seo[key]) {
                    BackwardCompSEOOptions[key].forEach((alt) => {
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
        let seoHandler = new SeoMiddleware(this.options.siteId, this.options.seo, {subDir: this.options.subDir, subDirBase: this.options.subDirBase, subDirOptional: this.options.subDirOptional});
        this.seoMiddleware = seoHandler.middleware();

        if (this.options.meta) {
            this.meta = this.options.meta;
            this.processKeywords(this.options.keywords);
        }
        if (this.options.snippet) {
            this.snippet = this.options.snippet;
        }

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
    public getSiteMeta(cbk: (e?: Error) => void) {
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
                let data: SiteData = JSON.parse(body);
                debug("data:", data);
                this.saveSiteMeta(data);
                cbk();
            } catch (e) {
                debug(e);
            }
        });
    }
    public saveSiteMeta(data: SiteData) {
        let {snippet, meta} = data;
        this.snippet = snippet;
        this.meta = meta;
        this.processKeywords(data.keywords);
        this.LOCALE_REGEX = null;
        data.id = this.options.siteId;
        fs.writeFile(this.snippetUrl(), JSON.stringify(data), (error) => {
            if (error) {
                console.error("Error saving snippet to cache", error);
            }
        });
    }
    public snippetUrl() {
        return `${OS.tmpdir()}/snippet.${this.options.siteId}`;
    }
    public getLocale(req: ExtendedRequest): string {
        if (req.headers["bablic-locale"]) {
            return req.headers["bablic-locale"] as string;
        }

        let auto = this.meta.autoDetect;
        let defaultLocale = this.meta.default;
        let customUrls = this.meta.customUrls;
        let localeKeys = this.meta.localeKeys.slice();
        localeKeys.push(this.meta.original);
        let localeDetection = this.meta.localeDetection;
        if (this.options.subDir) {
            localeDetection = "subdir";
        }
        return getLocaleByURL(
            url_parser.parse(getCurrentUrl(req)),
            localeDetection,
            customUrls,
            detectLocaleFromCookie(req, this.meta),
            defaultLocale,
            auto ? detectLocaleFromHeader(req) : "",
            false,
            this.options.locale,
            this.options.subDirBase,
            this.options.folders,
            localeKeys,
        );

    }
    public loadSiteMeta(cbk: (e?: Error) => void) {
        debug("loading meta from file");
        fs.readFile(this.snippetUrl(), (error, data) => {
            if (error) {
                debug("no local file, getting from server");
                return this.getSiteMeta(cbk);
            }

            debug("reading from temp file");
            try {
                let object: SiteData = JSON.parse(data.toString("utf8"));
                if (object.id != this.options.siteId || object.error) {
                    debug("not of this site id");
                    return this.getSiteMeta(cbk);
                }
                this.meta = object.meta;
                this.snippet = object.snippet;
                this.processKeywords(object.keywords);
                cbk();
            } catch (e) {
                debug(e);
                return this.getSiteMeta(cbk);
            }

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
                this.getSiteMeta(() => debug("refreshed snippet"));
            });
        });
    }
    public handleBablicCallback(req: ExtendedRequest, res: ExtendedResponse) {
        this.getSiteMeta(() => debug("site snippet refreshed"));
        res.end("OK");
    }
    public getLink(locale: string, url: string): string {
        let parsed = url_parser.parse(url);
        return getLink(locale, parsed, this.meta, this.options);
    }
    public altTags(url: string, locale: string) {
        let locales = this.meta.localeKeys || [];
        let tags = _(locales)
            .concat([this.meta.original])
            .without(locale)
            .map((l: string) => `<link rel="alternate" href="${this.getLink(l, url)}" hreflang="${l == this.meta.original ? "x-default" : l}">`)
            .valueOf() as string[];
        return tags.join("");
    }
    private generateOriginalPath(url: string, locale: string): string {
        let urlParts = url.split("?");
        let pathname = urlParts[0];
        let reversed = this.reverseKeywordByLocale[locale];
        let original = pathname.split("/").map((p) => reversed[p] || p).join("/");
        if (original != pathname) {
            urlParts[0] = original;
            return urlParts.join("?");
        } else {
            return null;
        }
    }
    private generateTranslatedPath(url: string, locale: string): string {
        let urlParts = url.split("?");
        let pathname = urlParts[0];
        let proper = this.keywordsByLocale[locale];
        let translated = pathname.split("/").map((p) => proper[p] || p).join("/");
        if (translated != pathname) {
            urlParts[0] = translated;
            return urlParts.join("?");
        } else {
            return null;
        }
    }

    public handle(req: ExtendedRequest, res: ExtendedResponse, next: () => void) {
        if (!req.originalUrl) {
            req.originalUrl = req.url;
        }
        if ((req.originalUrl == "/_bablicCallback" && req.method == "POST") || req.headers["x-bablic-refresh"]) {
            debug("Redirecting to Bablic callback");
            return this.handleBablicCallback(req, res);
        }
        res.setHeader("x-bablic-id", this.options.siteId);
        if (!this.LOCALE_REGEX && this.options.subDir && this.meta && this.meta.localeKeys) {
            this.LOCALE_REGEX = RegExp("^(?:" + escapeRegex(this.options.subDirBase) + ")?\\/(" + this.meta.localeKeys.join("|") + ")\\b");
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

        let locale = this.getLocale(req);

        req.bablic = {
            locale,
            proxied: false,
        };

        let _snippet = this.snippet;

        if (this.options.subDir && this.LOCALE_REGEX) {
            req.url = req.url.replace(this.LOCALE_REGEX, "");
            req.originalUrl = req.originalUrl.replace(this.LOCALE_REGEX, "");
            _snippet = `<script type="text/javascript">var bablic=bablic||{};bablic.localeURL="subdir";bablic.subDirBase="${this.options.subDirBase}";bablic.subDirOptional=${!!this.options.subDirOptional};</script>` + _snippet;
        }

        if (this.reverseKeywordByLocale && this.reverseKeywordByLocale[locale]) {
            let original = this.generateOriginalPath(req.url, locale);
            // build original URL, so server will return proper content
            if (original) {
                req.url = original;
                req.originalUrl = this.generateOriginalPath(req.originalUrl, locale) || req.originalUrl;
            } else {
                // check to see if there is a translated URL, if so, it should be redirected to it
                let translated = this.generateTranslatedPath(req.originalUrl, locale);
                if (translated) {
                    res.writeHead(301, {location: translated});
                    return res.end();
                }

            }
        }

        if (this.meta.original == locale) {
            _snippet = _snippet.replace("<script", "<script async");
        }

        extendResponseLocals(res, {
            bablic: {
                locale,
                snippet: _snippet,
                snippetBottom: "",
                snippetTop: "<!-- start Bablic Head -->" + this.altTags(req.originalUrl, locale) + _snippet + "<!-- start Bablic Head -->",
            },
        });

        if (!this.seoMiddleware) {
            return next();
        }

        if (locale == this.meta.original) {
            debug("ignored same language", req.url);
            return next();
        }
        return this.seoMiddleware(this.meta, this.keywordsByLocale, this.reverseKeywordByLocale, req, res, next);
    }

    private processKeywords(keywords: {[keyword: string]: {[locale: string]: string}}) {
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

function extendResponseLocals(res: ExtendedResponse, context: {}) {
    if (typeof(res.locals) == "function") {
        res.locals(context);
    } else if (res.locals) {
        _.extend(res.locals, context);
         } else {
        res.locals = context;
         }
}

function detectLocaleFromHeader(req: ExtendedRequest): string {
    let header = req.headers["accept-language"];
    if (!header) {
        return "";
    }
    let langs = (header as string).split(",");
    if (langs.length > 0) {
        return langs[0].replace("-", "_");
    }
    return "";
}

function detectLocaleFromCookie(req: ExtendedRequest, meta: SiteMeta) {
    let cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return "";
    }
    if (!meta.localeKeys) {
        return "";
    }
    let cookies = (req as any).cookies || cookie.parse(cookieHeader as string);
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

function getCurrentUrl(req){
    return `http://${req.headers.host}${req.originalUrl}`;
}


