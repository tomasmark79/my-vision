#!/bin/bash

SOURCES="
    config.js
    dbus.js
    dialog.js
    extension.js
    prefs.js
    prefs_widgets.js
    
    data/resources.gresource
    "

BLUEPRINT_FILES="
    data/ui/config_row.blp
    data/ui/config_row_drag_widget.blp
    data/ui/preferences_pages.blp
    data/ui/shortcut_dialog.blp
    data/ui/shortcut_row.blp
    "

function Help()
{
    echo "Usage: $(basename $0) [-bil]."
    echo "  -b  build the extension"
    echo "  -i  install the extension"
    echo "  -l  log out gnome session afterwards"
}

build=""
install=""

while getopts ":bil" option; do
    case $option in
    b)
        build=1;;
    i)
        install=1;;
    l)
        logout=1;;
    *)
        Help
        exit
        ;;
    esac
done


if [[ $build ]]; then
    # Compile blueprint files to xml
    blueprint-compiler batch-compile ./data ./data $BLUEPRINT_FILES

    # Compile the resources
    glib-compile-resources --sourcedir data/ data/resources.gresource.xml
    
    EXTRA_SOURCES=""
    for SCRIPT in ${SOURCES}; do
        EXTRA_SOURCES="${EXTRA_SOURCES} --extra-source=${SCRIPT}"
    done
    
    gnome-extensions pack --force $EXTRA_SOURCES
fi

if [[ $install ]]; then
    gnome-extensions install --force *.zip
fi

if [[ $logout  ]]; then
    gnome-session-quit --logout --no-prompt
fi
