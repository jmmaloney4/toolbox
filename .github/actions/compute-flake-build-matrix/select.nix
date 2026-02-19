system: outputs:
builtins.listToAttrs (
  map
    (catName:
      let
        cat = builtins.getAttr catName outputs;
      in
      {
        name = catName;
        value = if builtins.isAttrs cat && builtins.hasAttr system cat then builtins.getAttr system cat else {};
      }
    )
    (builtins.attrNames outputs)
)
