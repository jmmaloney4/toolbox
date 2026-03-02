system: outputs: let
  # Categories to expose for building. Extend this list to add more.
  categories = [
    "packages"
    "checks"
  ];

  pick = name: let
    category = builtins.getAttr name outputs;
  in
    if
      category
      != null
      && builtins.isAttrs category
      && builtins.hasAttr system category
    then category.${system} // {recurseForDerivations = true;}
    else {};
in
  builtins.listToAttrs (map (name: {
      inherit name;
      value = pick name;
    })
    categories)
