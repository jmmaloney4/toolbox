{
  inputs = {
    ### Nixpkgs ###
    # nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:nixos/nixpkgs/70801e06d9730c4f1704fbd3bbf5b8e11c03a2a7"; # https://github.com/NixOS/nixpkgs/issues/483584

    jackpkgs = {
      url = "github:jmmaloney4/jackpkgs";
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
        jackpkgs.flakeModules.default
      ];

      jackpkgs.projectRoot = ./.;
      jackpkgs.nodejs = {
        enable = true;
        pnpmDepsHash = "sha256-9LFcramMzlGSmxVIgy0xkXKhLRCY70wGDFUps87nKUQ=";
        projectRoot = ./.;
      };
      jackpkgs.checks.typescript.tsc.enable = true;
      jackpkgs.checks.vitest.enable = true;
      jackpkgs.pulumi.enable = false;

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        lib,
        ...
      }: let
        renovateConfigFiles = [
          ".github/renovate.json5"
          "renovate/all.json"
          "renovate/default.json"
          "renovate/lock-maintenance.json"
          "renovate/major-updates.json"
          "renovate/minor-patch-automerge.json"
          "renovate/nix.json"
          "renovate/pulumi.json"
          "renovate/security.json"
        ];

        renovateConfigPaths = map (path: "${self.outPath}/${path}") renovateConfigFiles;
      in {
        pre-commit.settings.hooks.mypy.enable = lib.mkForce false;
        pre-commit.settings.hooks.tsc.enable = lib.mkForce false;

        checks.renovate-config = pkgs.runCommand "renovate-config" {} ''
          cd ${self.outPath}
          for config in ${lib.concatMapStringsSep " " lib.escapeShellArg renovateConfigPaths}; do
            RENOVATE_CONFIG_FILE="$config" ${lib.getExe' pkgs.renovate "renovate-config-validator"} --strict
          done
          touch "$out"
        '';
        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.jackpkgs.outputs.devShell
          ];
          buildInputs = with pkgs; [
            pnpm
            envsubst
            renovate
          ];
        };
      };
    });
}
