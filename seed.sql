INSERT INTO roles (name, permissions, sort_order) VALUES
 ('Owner', '*', 10),
 ('Editor', 'categories.view,categories.edit,platforms.view,platforms.create,languages.view,languages.create,interfaces.view,interfaces.create,hotlinks.view,hotlinks.create,hotlinks.edit,publishers.view,publishers.create,publishers.edit,software.view,software.create,software.edit,versions.view,versions.create,versions.edit,files.view,files.create,files.edit,bucket.view,requests.view,requests.edit,history.view', 20),
 ('Reader', 'categories.view,platforms.view,platforms.create,languages.view,languages.create,interfaces.view,interfaces.create,hotlinks.view,hotlinks.create,hotlinks.edit,publishers.view,publishers.create,publishers.edit,software.view,versions.view,files.view,requests.view', 30);
