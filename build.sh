#!/usr/bin/env bash


# Copyright (C) 2026 Tomáš Mark

# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

EXTENSION_UUID="my-vision@digitalspace.name"
ZIP_NAME="${EXTENSION_UUID}.zip"

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

function RequireCommand()
{
    if ! command -v "$1" >/dev/null 2>&1; then
        echo -e "${RED}Error: '$1' not found.${NC}"
        if [[ -n "$2" ]]; then
            echo -e "${YELLOW}$2${NC}"
        fi
        exit 1
    fi
}

function Help()
{
    echo "Usage: $(basename $0) [-bilr]"
    echo "  -b  build the extension"
    echo "  -i  install the extension"
    echo "  -l  log out gnome session afterwards"
    echo "  -r  build release zip with validation"
}

build=""
install=""
logout=""
release=""

while getopts ":bilr" option; do
    case $option in
    b)
        build=1;;
    i)
        install=1;;
    l)
        logout=1;;
    r)
        release=1;;
    *)
        Help
        exit
        ;;
    esac
done

# If no options provided, show help
if [[ -z "$build" && -z "$install" && -z "$logout" && -z "$release" ]]; then
    Help
    exit 0
fi

# Build release version with validation
if [[ $release ]]; then
    echo -e "${BLUE}GNOME Shell Extension Release Builder${NC}"
    echo -e "${BLUE}=====================================${NC}"
    echo

    # Check if we're in the right directory
    if [[ ! -f "metadata.json" || ! -f "extension.js" ]]; then
        echo -e "${RED}Error: metadata.json or extension.js not found!${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Checking extension files...${NC}"

    # Required files check
    REQUIRED_FILES=("metadata.json" "extension.js")
    for file in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$file" ]]; then
            echo -e "${RED}Error: Required file '$file' not found!${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓${NC} Found required file: $file"
    done

    # Validate metadata.json
    echo -e "${YELLOW}Validating metadata.json...${NC}"
    if ! python3 -m json.tool metadata.json > /dev/null 2>&1; then
        echo -e "${RED}Error: metadata.json is not valid JSON!${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} metadata.json is valid JSON"

    # Validate and compile GSettings schema if present
    if [[ -d "schemas" ]]; then
        echo -e "${YELLOW}Compiling GSettings schemas...${NC}"

        SCHEMA_FILE="schemas/org.gnome.shell.extensions.my-vision.gschema.xml"
        if [[ -f "$SCHEMA_FILE" ]]; then
            RequireCommand "xmllint" "Install libxml2 (NixOS: nix shell nixpkgs#libxml2)"
            if ! xmllint --noout "$SCHEMA_FILE" 2>/dev/null; then
                echo -e "${RED}Error: Schema XML is not valid!${NC}"
                exit 1
            fi
            echo -e "${GREEN}✓${NC} Schema XML is valid"

            RequireCommand "glib-compile-schemas" "Install glib.dev (NixOS: nix shell nixpkgs#glib.dev)"
            if ! glib-compile-schemas schemas/; then
                echo -e "${RED}Error: Failed to compile schemas!${NC}"
                exit 1
            fi
            echo -e "${GREEN}✓${NC} Schemas compiled successfully"
        fi
    fi

    # Compile blueprint files
    echo -e "${YELLOW}Compiling blueprint files...${NC}"
    RequireCommand "blueprint-compiler" "Install blueprint-compiler (NixOS: nix shell nixpkgs#blueprint-compiler)"
    blueprint-compiler batch-compile ./data ./data $BLUEPRINT_FILES
    echo -e "${GREEN}✓${NC} Blueprint files compiled"

    # Compile resources
    echo -e "${YELLOW}Compiling resources...${NC}"
    RequireCommand "glib-compile-resources" "Install glib.dev (NixOS: nix shell nixpkgs#glib.dev)"
    glib-compile-resources --sourcedir data/ data/resources.gresource.xml
    echo -e "${GREEN}✓${NC} Resources compiled"

    # Pack the extension
    echo -e "${YELLOW}Packing extension...${NC}"
    RequireCommand "gnome-extensions" "Install gnome-extensions-app"
    [[ -f "$ZIP_NAME" ]] && rm "$ZIP_NAME"

    EXTRA_SOURCES=""
    for SCRIPT in ${SOURCES}; do
        EXTRA_SOURCES="${EXTRA_SOURCES} --extra-source=${SCRIPT}"
    done

    gnome-extensions pack --force $EXTRA_SOURCES
    echo -e "${GREEN}✓${NC} Release zip created: $ZIP_NAME ($(du -h "$ZIP_NAME" | cut -f1))"
    echo -e "${GREEN}Ready for submission to extensions.gnome.org${NC}"
fi

# Build standard version
if [[ $build ]]; then
    echo "Building extension..."

    # Compile blueprint files
    RequireCommand "blueprint-compiler" "Install blueprint-compiler (NixOS: nix shell nixpkgs#blueprint-compiler)"
    blueprint-compiler batch-compile ./data ./data $BLUEPRINT_FILES

    # Compile resources
    RequireCommand "glib-compile-resources" "Install glib.dev (NixOS: nix shell nixpkgs#glib.dev)"
    glib-compile-resources --sourcedir data/ data/resources.gresource.xml

    # Pack the extension
    RequireCommand "gnome-extensions" "Install gnome-extensions-app"
    EXTRA_SOURCES=""
    for SCRIPT in ${SOURCES}; do
        EXTRA_SOURCES="${EXTRA_SOURCES} --extra-source=${SCRIPT}"
    done

    gnome-extensions pack --force $EXTRA_SOURCES
    echo "✓ Extension built: $ZIP_NAME"
fi

if [[ $install ]]; then
    echo "Installing extension..."
    gnome-extensions install --force "$ZIP_NAME"
    echo "✓ Extension installed"
fi

if [[ $logout ]]; then
    echo "Logging out..."
    gnome-session-quit --logout --no-prompt
fi
