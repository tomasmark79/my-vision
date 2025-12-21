# My-Vision
is improved fork of Display Configuration Switcher

> 🌱 **Help Keep This Going**
> Your support makes a real difference. If you value my work and want to help me continue creating, please consider making a donation.  
> 💙 **Donate here:** [https://paypal.me/TomasMark](https://paypal.me/TomasMark)
> Every contribution is truly appreciated ✨

<div>
    <img style="margin: 0px auto 0px; display: block;" src="./data/icon/my-vision.svg" width="256" height="256"/>
</div>

<div align="center">
    <img style="margin: 0px 10px 0px; display: inline-block;" src="./screen01.png" width="400">
    <img style="margin: 0px 10px 0px; display: inline-block;" src="./screen02.png" width="400">
</div>

## Description
Quickly change the display configuration from the system menu.

## Impovements over the original Display Configuration Switcher
- the order of video output connectors does not matter, the target is always identified by the display name
- fixed some other bugs from the original version
 
## Installation

The recommended way to install the extension is via GNOME Extensions website:

https://extensions.gnome.org/extension/9014/my-vision/

Alternatively, you can clone this repository and build the extension manually.

To build and install the extension, run:
```bash
bash build.sh -bi
```

It is also possible to add `-l` to immediately logout the GNOME session after this:
```bash
bash build.sh -bil
```

## Authors and acknowledgment
Tomáš Mark (current maintainer on this repository)
Christophe Van den Abbeele (original author)

## License
GPLv3 - Copyright (C) 2024 Tomáš Mark