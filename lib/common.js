"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SUB_DIR = /^(\/(\w\w(_\w\w)?))(?:\/|$)/;
const SUB_DOMAIN_PIPE_REGEX = /(?:^|_)(\w\w(?:_\w\w)?)_(?:b\-[mt]\-)?[0-9a-f]{24,25}_pipe/i;
const SUB_DOMAIN_REGEX = /^(?:www\.)?(\w\w(?:_\w\w)?)\./i;
function escapeRegexNoWildcard(str) {
    return (str + '').replace(/([.?+^$[\]\\/(){}|-])/g, "\\$1");
}
function createLocaleRegexChoices(locales, folders) {
    const folderNames = [];
    const localeAdded = {};
    if (folders) {
        for (const folderKey in folders) {
            folderNames.push(escapeRegexNoWildcard(folderKey));
            localeAdded[folders[folderKey]] = 1;
        }
    }
    if (locales) {
        for (const locale of locales) {
            if (!localeAdded[locale]) {
                folderNames.push(locale);
            }
        }
    }
    if (!folderNames.length)
        return null;
    return folderNames.join('|');
}
exports.createLocaleRegexChoices = createLocaleRegexChoices;
function createLocaleRegex(locales, folders) {
    const localeRegexChoices = createLocaleRegexChoices(locales, folders);
    return localeRegexChoices ? RegExp('^(\\/(' + localeRegexChoices + '))(?:\\/|$)', 'i') : SUB_DIR;
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
function getLocaleByURL(parsedUrl, locale_detection, localeConfigs, cookieLocale, siteDefaultLocale, detectedLocale, isProxy, explicitLocale, subDirBase, folders, locales, handler) {
    if (handler) {
        return handler(parsedUrl, cookieLocale, siteDefaultLocale, detectedLocale) || siteDefaultLocale;
    }
    switch (locale_detection) {
        case 'querystring':
            if (parsedUrl.query && typeof (parsedUrl.query) == 'object')
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
            var localeRegex = createLocaleRegex(locales, folders);
            var pathname = parsedUrl.pathname;
            if (subDirBase)
                pathname = pathname.replace(subDirBase, '');
            var match = localeRegex.exec(pathname);
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
exports.getLocaleByURL = getLocaleByURL;
function getLink(locale, parsed, meta, options, fromLocale) {
    options = options || {};
    let protocol = parsed.protocol || '';
    let hostname = parsed.hostname;
    let pathname = parsed.pathname || '/';
    parsed.search = parsed.search || '';
    parsed.hash = parsed.hash || '';
    let returnFull = options.returnFull && !!hostname;
    let localeDetection = meta.localeDetection;
    let original = meta.original;
    let handler = meta.rewriteUrlHandler;
    if (handler) {
        if (typeof (handler) == "string") {
            handler = meta.rewriteUrlHandler = eval(handler);
        }
        return handler(parsed, locale, fromLocale);
    }
    if (options.subDir)
        localeDetection = 'subdir';
    if (localeDetection == 'custom' && !(meta.customUrls && meta.customUrls[locale]))
        localeDetection = 'querystring';
    switch (localeDetection) {
        case 'custom':
            let customUrl = meta.customUrls[locale];
            let confDomain = customUrl.indexOf('/') > -1 ? customUrl.substr(0, customUrl.indexOf('/')) : customUrl;
            return protocol + '//' + confDomain + pathname + parsed.search + parsed.hash;
        case 'querystring':
            if (/[?&]locale=([^&]+)/.test(parsed.search))
                parsed.search = parsed.search.replace(/([?&]locale=)([^&]+)/, '$1' + locale);
            else {
                if (parsed.search)
                    parsed.search = parsed.search + '&locale=' + locale;
                else
                    parsed.search = '?locale=' + locale;
            }
            if (returnFull)
                return protocol + '//' + hostname + pathname + parsed.search + parsed.hash;
            return pathname + parsed.search + parsed.hash;
        case 'subdir':
            if (options.subDirBase)
                pathname = pathname.replace(options.subDirBase, '');
            const localeRegex = createLocaleRegex(meta.localeKeys, options.folders);
            let match = localeRegex.exec(pathname);
            if (match) {
                pathname = pathname.substr(match[1].length);
                if (pathname.length == 0)
                    pathname = '/';
            }
            let prefix = '';
            if (options.folders)
                prefix = '/' + getFolder(locale, options.folders);
            else if (locale != original)
                prefix = '/' + locale;
            if (options.subDirBase && (!options.subDirOptional || locale != original))
                prefix = options.subDirBase + prefix;
            if (returnFull)
                return protocol + '//' + hostname + prefix + pathname + parsed.search + parsed.hash;
            return prefix + pathname + parsed.search + parsed.hash;
        case 'hash':
            if (returnFull)
                return protocol + '//' + hostname + pathname + parsed.search + '#locale=' + locale;
            return '#locale_' + locale;
    }
    return `javascript:bablic.setLanguage("${locale}");`;
}
exports.getLink = getLink;
function getFolder(locale, folders) {
    for (let folder in folders) {
        if (folders[folder] == locale)
            return folder;
    }
    locale = locale.substr(0, 2);
    for (let folder in folders) {
        if (folders[folder].substr(0, 2) == locale)
            return folder;
    }
    return locale;
}
