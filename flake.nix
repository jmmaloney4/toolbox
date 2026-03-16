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
        version = 22;
        pnpmVersion = "10";
        pnpmDepsHash = "sha256-CUNWeH1b6gNV0Ivl3ImA3YLyu7I44Yln6omOwOdOHfg=";
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
      }: {
        # Match yard's intent: keep the dedicated jackpkgs tsc check enabled,
        # but skip the pre-commit tsc hook in sandboxed Nix runs.
        pre-commit.settings.hooks.tsc.enable = lib.mkForce false;

        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.jackpkgs.outputs.devShell
          ];
          buildInputs = with pkgs; [
            pnpm
            envsubst
          ];
        };
      };
    });
}
