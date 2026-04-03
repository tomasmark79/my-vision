{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    blueprint-compiler
    glib          # glib-compile-resources, gnome-extensions
    gnome-extensions-cli
  ];
}
