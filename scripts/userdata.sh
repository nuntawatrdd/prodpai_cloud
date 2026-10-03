#!/bin/bash
    apt update -y
    apt install -y nginx
    rm -rf /var/www/html/*
    
    echo "<h1>Hello Terraform [${local.name_prefix}-cloud]</h1>" > /var/www/html/index.html
    systemctl enable nginx
    systemctl restart nginx

    echo "READY" > /var/www/html/ready.txt