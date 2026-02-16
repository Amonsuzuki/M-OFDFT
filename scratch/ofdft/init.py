import pyscf
import pyscf.df

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

def ref_etb(mol, beta):
    reference_mol = pyscf.M(atom='H 0 0 0; C 0 -0.5 0.5; N 0 0.5 1; O 0 0.5 -0.5; F 0.5 0 0', basis=mol.basis, spin=1)
    basis = pyscf.df.aug_etb(reference_mol, beta)
    return basis
