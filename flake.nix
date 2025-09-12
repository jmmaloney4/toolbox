{
  inputs = {
    ### Nixpkgs ###
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    jackpkgs = {
      url = "github:jmmaloney4/jackpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
      inputs.just-flake.follows = "just-flake";
    };

    ### Flake / Project Inputs ###
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
    };

    flake-root = {
      url = "github:srid/flake-root";
    };

    just-flake = {
      url = "github:juspay/just-flake";
    };

    pre-commit-hooks = {
      url = "github:cachix/pre-commit-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
      # inputs.flake-utils.inputs.systems.follows = "systems";
    };

    systems.url = "github:nix-systems/default";

    treefmt = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    jackpkgs,
    flake-parts,
    flake-root,
    just-flake,
    pre-commit-hooks,
    systems,
    treefmt,
  } @ inputs:
    flake-parts.lib.mkFlake {inherit inputs;} ({
      withSystem,
      inputs,
      ...
    }: {
      systems = import systems;
      imports = [
        flake-root.flakeModule
        just-flake.flakeModule
        pre-commit-hooks.flakeModule
        treefmt.flakeModule
      ];

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        lib,
        ...
      }: {
        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.just-flake.outputs.devShell
            config.pre-commit.devShell
            config.treefmt.build.devShell
          ];
          buildInputs = with pkgs; [
            fluxcd
            kubectl
            sops
          ];

          # Add comma alias for backwards compatibility
          shellHook = ''
            # Set up comma alias for just
            alias ','='just'
            echo ""
            echo "⚡ Alias ',' set to 'just' ✨"
            echo ""
          '';
        };

        pre-commit = {
          check.enable = true;
          settings.hooks.treefmt.enable = true;
          settings.settings.treefmt.package = config.treefmt.build.wrapper;
        };

        treefmt.config = {
          inherit (config.flake-root) projectRootFile;
          package = pkgs.treefmt;
          programs.alejandra.enable = true;
        };
        formatter = config.treefmt.build.wrapper;
      };
    });
}