import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import strip from 'rollup-plugin-strip';
import commonjs from '@rollup/plugin-commonjs';
import {terser} from "rollup-plugin-terser"

export default [

    {
        input: 'js/index.js',
        output: [
            // {file: 'dist/igv.esm.js', format: 'es'},
            // {file: 'dist/igv.esm.min.js', format: 'es', sourcemap: true, plugins: [terser()]}
            {file: '../base/static/igv/igv.esm.js', format: 'es'},
            {file: '../base/static/igv/igv.esm.min.js', format: 'es', sourcemap: true, plugins: [terser()]}
        ],
        plugins: [
            strip({
                debugger: true,
                functions: [/*'console.log', */'assert.*', 'debug']
            })
        ]
    },

    {
        input: 'js/index.js',
        output: [
            {file: '../base/static/igv/igv.js', format: 'umd', name: "igv"},
            {file: '../base/static/igv/igv.min.js', format: 'umd', name: "igv", sourcemap: true, plugins: [terser()]},
        ],
        plugins: [
            strip({
                debugger: true,
                functions: [/*'console.log', */'assert.*', 'debug']
            }),
            commonjs(),
            nodeResolve(),
            babel()
        ]
    }
];
