{
  inputs = {
    ### Nixpkgs ###
    # nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:nixos/nixpkgs/70801e06d9730c4f1704fbd3bbf5b8e11c03a2a7"; # https://github.com/NixOS/nixpkgs/issues/483584

    jackpkgs = {
      url = "github:jmmaloney4/jackpkgs/npm-workspace-lockfile";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
      inputs.systems.follows = "systems";
    };

    ### Flake / Project Inputs ###
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
    };

    systems.url = "github:nix-systems/default";
  };

  outputs = {
    self,
    nixpkgs,
    jackpkgs,
    flake-parts,
    systems,
  } @ inputs:
    flake-parts.lib.mkFlake {inherit inputs;} ({
      withSystem,
      inputs,
      ...
    }: {
      systems = import systems;
      imports = [
        jackpkgs.flakeModule
      ];

      jackpkgs.pulumi.enable = false;
      jackpkgs.nodejs.enable = true;
      jackpkgs.checks.typescript.enable = true;

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        lib,
        ...
      }: let
        nodejsPackage = pkgs.nodejs_22;
        nodeModulesFixed = pkgs.buildNpmPackage {
          pname = "node-modules";
          version = "1.0.0";
          src = ./.;
          nodejs = nodejsPackage;
          npmDeps = pkgs.importNpmLock {npmRoot = ./.;};
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          installPhase = ''
            mkdir -p "$out/node_modules"
            cp -a node_modules/. "$out/node_modules"
            if [ -d packages ]; then
              cp -a packages "$out"
            fi
          '';
        };
        nodejsDevShellFixed = pkgs.mkShell {
          packages = [
            nodejsPackage
          ];
          shellHook = ''
            if [ -d "${nodeModulesFixed}/node_modules/.bin" ]; then
              export PATH="${nodeModulesFixed}/node_modules/.bin:$PATH"
            fi
          '';
        };
      in {
        pre-commit.settings.hooks.mypy.enable = lib.mkForce false;

        # Override nodeModules to keep workspace symlinks resolvable
        jackpkgs.outputs.nodeModules = lib.mkForce nodeModulesFixed;
        jackpkgs.outputs.nodejsDevShell = lib.mkForce nodejsDevShellFixed;

        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.jackpkgs.outputs.devShell
          ];
          buildInputs = with pkgs; [
            envsubst
          ];
        };
      };
    });
}
