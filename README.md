# Bablic-Node-SDK

To install simply use NPM:
```sh
$ npm install --save bablic
```

Config your app:
```sh
bablic = require('./bablic');
options = {
  site_id: '[your site id]',
  root_url: 'http://[root url of your site]',
  sub_dir: true, // <- if you want to use sub_dir for languages like /es /fr
  seo: {
    default_cache: [ "http:/[url of smthing you know need caching]" ]
  }
};
app.use(bablic(options));
```
And use!
