{
  description = "A Nix-flake-based gjs development environment";

  outputs = { self, nixpkgs }: let
  in {
    devShell.x86_64-linux = 
      let
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in pkgs.mkShell {
      name = "gjs";
      
      packages = with pkgs; [
        gjs
      ];

      buildInputs = with pkgs; [
        libadwaita
        blueprint-compiler
        gobject-introspection
        glib
        gtk4
        libxml2
      ];
    };
  };
}
