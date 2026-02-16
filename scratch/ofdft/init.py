def get_init_coeff(init_method, mol, auxmol, *args, use_dm=False, **kwargs):
    methods = {
            'initguess_minao': initguess_minao,
            'initguess_fastminao': initguess_fastminao,
            'initguess_atom': initguess_atom,
            'initguess_1e': initguess_1e,
            'initguess_huckel': initguess_huckel,
            'random': init_random,
            'gt': init_gt,
            'halfgt': init_halfgt,
            }
    method = methods[init_nethod]
    return method(mol, auxmol, *args, use_dm=use_dm, **kwargs)
