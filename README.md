# Bablic-Node-SDK

To install simply use NPM:
```sh
$ npm install --save bablic
```

Config your app:
```sh
var bablic = require('./bablic');
var options = {
  site_id: '[your site id]',
  root_url: 'http://[root url of your site]',
  sub_dir: true, // <- if you want to use sub_dir for languages like /es /fr
  seo: {
    default_cache: [ "http:/[url of smthing you know need caching]" ]
  }
};
app.use(bablic(options));

app.get('/',function(req,res) { 
   console.log('the current language for the user is',req.bablic.locale);
   res.render('index.ejs',{});
});

```

In your layout template file you can add the snippet:

```

<html>
   <head>
      <%- bablic.snippetTop %>
   </head>
   <body>
      <%- body %>
      <%- bablic.snippetBottom %>
    </body>
</html>

```
And use!
