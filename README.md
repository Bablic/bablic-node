# Bablic-Node-SDK

To install simply use NPM:
```sh
$ npm install --save bablic
```

Config your app:

Javascript:
```sh
const {create} = require("bablic");
app.use(create({
   siteId: '[your site id]',
   rootUrl: 'http://[root url of your site]',
   subDir: true, // if you want to use sub dir for languages like /es/ /fr/
   }));
   
app.get('/',function(req,res) { 
   console.log('the current language for the user is',req.bablic.locale);
   res.render('index.ejs',{});
});

```

Typescript:
```sh
import {create} from "bablic";
app.use(create({
   siteId: '[your site id]',
   rootUrl: 'http://[root url of your site]',
   subDir: true, // if you want to use sub dir for languages like /es/ /fr/
   }));
```

In your layout template file you can add the snippet:

```

<html>
   <head>
      <%- bablic.snippetTop %>
   </head>
   <body>
      <%- body %>
    </body>
</html>

```
And use!
