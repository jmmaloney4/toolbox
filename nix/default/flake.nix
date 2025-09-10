{
  description = "Default development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    
    # Development tools
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    
    # Language servers and formatters
    nil = {
      url = "github:oxalica/nil";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.rust-overlay.follows = "rust-overlay";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, nil }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [
          (import rust-overlay)
        ];

        pkgs = import nixpkgs {
          inherit system overlays;
        };

        # Common development packages
        commonDevPackages = with pkgs; [
          # Build tools
          gnumake
          cmake
          ninja
          pkg-config

          # Version control
          git
          gh

          # Development tools
          direnv
          nil.packages.${system}.default # Nix LSP

          # Languages
          (rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rust-analyzer" ];
          })
          go
          python3
          nodejs
          
          # Cloud tools
          awscli2
          azure-cli
          google-cloud-sdk
          kubectl
          kubernetes-helm
          
          # Utilities
          jq
          yq
          ripgrep
          fd
          bat
          exa
          fzf
          htop
          tmux
        ];

      in
      {
        devShell = pkgs.mkShell {
          buildInputs = commonDevPackages;

          shellHook = ''
            # Add any shell initialization here
          '';
        };

        packages = {
          default = self.packages.${system}.devenv;
          devenv = pkgs.buildEnv {
            name = "devenv";
            paths = commonDevPackages;
          };
        };
      });
}
