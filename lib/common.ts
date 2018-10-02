import {IncomingMessage, ServerResponse} from "http";
import * as UrlParser from 'url';

const SUB_DIR = /^(\/(\w\w(_\w\w)?))(?:\/|$)/;
const SUB_DOMAIN_PIPE_REGEX = /(?:^|_)(\w\w(?:_\w\w)?)_(?:b\-[mt]\-)?[0-9a-f]{24,25}_pipe/i;
const SUB_DOMAIN_REGEX = /^(?:www\.)?(\w\w(?:_\w\w)?)\./i;

export interface ExtendedRequest extends IncomingMessage {
    originalUrl?: string;
    // set this field if you want to force specific locale for Bablic
    forceLocale?: string;
    bablic?:{
        locale: string;
        proxied?: boolean;
    }
}

export interface ExtendedResponse extends ServerResponse {
    locals?: any;
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export interface KeywordMapper {
    [locale: string]:{
        [keyword:string]: string
    }
}

function getLocaleFromFolder(folderLocale, locales) {
    var index = locales.indexOf(folderLocale);
    if (index > -1)
        return locales[index];
    folderLocale = folderLocale.substr(0, 2);
    for (var i = 0; i < locales.length; i++) {
        if (locales[i].substr(0, 2) == folderLocale)
            return locales[i];
    }
    return '';
}


export function getLocaleByURL(parsedUrl, locale_detection, localeConfigs, cookieLocale, siteDefaultLocale, detectedLocale, isProxy, explicitLocale, subDirBase, folders, locales) {
    switch (locale_detection) {
        case 'querystring':
            if (parsedUrl.query && typeof(parsedUrl.query) == 'object')
                return parsedUrl.query.locale;
            var matches = /locale=([^&]+)/.exec(parsedUrl.query || '');
            if (matches && matches.length == 2 && matches[1])
                return matches[1];
            return cookieLocale || detectedLocale || siteDefaultLocale;
        case "subdomain":
            var regex = isProxy ? SUB_DOMAIN_PIPE_REGEX : SUB_DOMAIN_REGEX;
            var matches = regex.exec(parsedUrl.hostname);
            if (matches && matches.length > 1 && matches[1])
                return matches[1];
            return siteDefaultLocale;
        case "subdir":
            var pathname = parsedUrl.pathname;
            if (subDirBase)
                pathname = pathname.replace(subDirBase, '');
            var match = SUB_DIR.exec(pathname);
            if (match) {
                if (folders && locales && folders[match[2]])
                    return getLocaleFromFolder(folders[match[2]], locales) || siteDefaultLocale;
                return match[2];
            }
            if (explicitLocale)
                return explicitLocale;
            if (cookieLocale)
                return cookieLocale;
            return detectedLocale || siteDefaultLocale;
        case "tld":
            var matches = /\.(\w\w)$/.exec(parsedUrl.hostname);
            if (matches && matches.length > 1 && matches[1])
                return matches[1];
            return null;
        case "custom":
            var parseDomainRule = function (str) {
                return RegExp((str + '').replace(/([.?+^$[\]\\(){}|-])/g, "\\$1").replace(/\*/g, '.*'), 'i');
            };

            for (var locale in localeConfigs) {
                var urlPattern = localeConfigs[locale];
                if (urlPattern && parseDomainRule(urlPattern).test(parsedUrl.href))
                    return locale;
            }
            return explicitLocale || siteDefaultLocale;
        case "hash":
            var matches = /^#!locale=(\w\w(?:_\w\w)?)$/.exec(parsedUrl.hash || '');
            if (matches && matches.length > 1 && matches[1])
                return matches[1];
            return cookieLocale || detectedLocale || siteDefaultLocale;
        default:
            return cookieLocale;
    }
}
export interface SiteMeta{
    localeDetection: string;
    original: string;
    customUrls: {
        [locale:string]:string
    };
    default: string;
    autoDetect: boolean;
    localeKeys: string[];
    timestamp: number;
    includeQueryString: boolean;
    includeHash: boolean;
    singlePageApp: boolean;
    qsParams: string[],
    domain: string;
    mountSubs: string[];
}


export interface LastModifiedByLocale {
    [locale: string]: Date
}

export interface BablicLinkOptions {
    subDir?: boolean;
    subDirBase?: string;
    subDirOptional?: boolean;
    returnFull?: boolean;
    folders?:{[locale:string]:string}
}

export function getLink(locale: string, parsed: UrlParser.Url, meta: SiteMeta, options?: BablicLinkOptions) {
    options = options || {};
    let protocol = parsed.protocol || '';
    let hostname = parsed.hostname;
    let pathname = parsed.pathname || '/';
    let search = parsed.search || '';
    let hash = parsed.hash || '';

    let returnFull = options.returnFull && !!hostname;
    let localeDetection = meta.localeDetection;
    let original = meta.original;
    if(options.subDir)
        localeDetection = 'subdir';
    if(localeDetection == 'custom' && !(meta.customUrls && meta.customUrls[locale]))
        localeDetection = 'querystring';

    switch(localeDetection){
        case 'custom':
            let customUrl = meta.customUrls[locale];
            let confDomain = customUrl.indexOf('/') > -1 ? customUrl.substr(0,customUrl.indexOf('/')) : customUrl;
            return protocol + '//' + confDomain + pathname + search + hash;

        case 'querystring':
            if (/[?&]locale=([^&]+)/.test(search))
                search = search.replace(/([?&]locale=)([^&]+)/, '$1' + locale);
            else {
                if (search)
                    search = search + '&locale=' + locale;
                else
                    search = '?locale=' + locale;
            }
            if(returnFull)
                return protocol + '//' + hostname + pathname + search + hash;

            return pathname + search + hash;

        case 'subdir':
            if(options.subDirBase)
                pathname = pathname.replace(options.subDirBase,'');
            let match = SUB_DIR.exec(pathname);
            if (match) {
                pathname = pathname.substr(match[1].length);
                if (pathname.length == 0)
                    pathname = '/';
            }
            let prefix = '';
            if(options.folders)
                prefix = '/' + getFolder(locale,options.folders);
            else if(locale != original)
                prefix = '/' + locale;
            if(options.subDirBase && (!options.subDirOptional || locale != original))
                prefix = options.subDirBase + prefix;
            if(returnFull)
                return protocol + '//' + hostname + prefix + pathname + search + hash;
            return prefix + pathname + search  + hash;
        case 'hash':
            if(returnFull)
                return protocol + '//' + hostname + pathname + search + '#locale=' + locale;
            return '#locale_' + locale;
    }
    return `javascript:bablic.setLanguage("${locale}");`;
}


function getFolder(locale: string,folders:{[locale:string]:string}) :string{
    for(let folder in folders){
        if(folders[folder] == locale)
            return folder;
    }
    locale = locale.substr(0,2);
    for(let folder in folders){
        if(folders[folder].substr(0,2) == locale)
            return folder;
    }
    return locale;
}
